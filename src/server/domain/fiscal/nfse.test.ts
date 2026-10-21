import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, comandas, fiscalDocuments, fiscalSequences, professionals } from "@/server/db/schema";
import { DEFAULT_FISCAL_EMPRESA, DEFAULT_FISCAL_REGRAS } from "@/lib/fiscal-settings";
import { resetDb } from "../../../../test/db";
import { bahia, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { makeTestPfx, TEST_CERT_CNPJ, TEST_PFX_PASSWORD, writeTestPfx } from "../../../../test/fiscal-cert";
import { readPfx } from "./certificate";
import { createSefinClient, type SefinTransport } from "./sefin-client";
import { addItem, addPayment, closeComanda, openWalkInComanda, setComandaNota } from "../caixa/comandas";
import { cancelNfse, emitNfse, processPendingNfse, queueNfseTx, type NfseDeps } from "./nfse";
import { loadNotaFiscalInfo } from "./draft";

type Req = Parameters<SefinTransport>[0];
type Answer = { status: number; json: unknown } | "timeout";
const CHAVE = "29274082112223330001810000000000000000000000000042"; // 50 números
const gz = (s: string) => gzipSync(Buffer.from(s, "utf8")).toString("base64");
const ungz = (b: string) => gunzipSync(Buffer.from(b, "base64")).toString("utf8");
const AUTORIZADA: Answer = { status: 201, json: { idDps: "x", chaveAcesso: CHAVE, nfseXmlGZipB64: gz("<NFSe><infNFSe>ok</infNFSe></NFSe>") } };
const DPS_EXISTE: Answer = { status: 200, json: { chaveAcesso: CHAVE } };
const DPS_NAO_EXISTE: Answer = { status: 404, json: { erro: [{ Codigo: "E2404", Descricao: "Não foi gerada uma NFS-e com o identificador de DPS informado" }] } };

/** Transporte de mentira (nunca a Sefin): responde POST e GET por filas separadas; a última resposta de cada fila se repete. */
function stub(o: { post?: Answer[]; get?: Answer[] }) {
  const calls: Req[] = [];
  const post = [...(o.post ?? [])], get = [...(o.get ?? [])];
  const next = (q: Answer[]) => (q.length > 1 ? q.shift()! : q[0]);
  const transport: SefinTransport = async (r) => {
    calls.push(r);
    const a = r.method === "POST" ? next(post) : next(get);
    if (!a) throw new Error("sem resposta no stub");
    if (a === "timeout") throw new Error("tempo esgotado (30 s)");
    return a;
  };
  return { calls, posts: () => calls.filter((c) => c.method === "POST"), gets: () => calls.filter((c) => c.method === "GET"), transport };
}

const cert = readPfx(makeTestPfx(), TEST_PFX_PASSWORD);
let clock: Date;
const deps = (transport: SefinTransport): NfseDeps => ({ client: createSefinClient({ environment: "teste", transport }), cert, now: () => clock });
const docsOf = (comandaId: string) => db.select().from(fiscalDocuments).where(eq(fiscalDocuments.comandaId, comandaId)).orderBy(fiscalDocuments.createdAt);
const later = (min: number) => { clock = new Date(clock.getTime() + min * 60_000); };
const EMPRESA = { ...DEFAULT_FISCAL_EMPRESA, cnpj: TEST_CERT_CNPJ, inscricaoMunicipal: "123456", regime: "simples", aliquotaSimplesBp: 600 };

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => {
  await resetDb(); s = await setupCaixa();
  clock = bahia(15, 18);
  await setSetting("nfse_modo", "teste");
  await setSetting("caixa_regras", { notaPadrao: "sem_cpf" }); // o padrão novo é Perguntar; estes testes fecham sem escolher a nota
  await setSetting("fiscal_empresa", EMPRESA);
});
afterEach(() => { vi.unstubAllEnvs(); });

/** Comanda fechada com um Corte de R$ 121,50 (valor da nota). */
const fechada = () => comanda({ day: "2026-10-15", by: s.cati.id, clientName: "Paula", items: [{ label: "Corte", unitCents: 12150, professionalId: s.bia.id, netCents: 12150 }] });

describe("emitir pela comanda", () => {
  it("emitir: autorizada grava chave; clicar de novo não cria outra", async () => {
    const c = await fechada();
    const st = stub({ post: [AUTORIZADA] });
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    expect(r.status).toBe("autorizada");
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ id: r.id, status: "autorizada", accessKey: CHAVE, number: 1, series: 1, environment: "teste", amountCents: 12150, attempts: 1 });
    expect(d.authorizedAt).toEqual(clock);
    expect(d.responseBody).toContain("<NFSe>");
    expect(d.requestXml).toContain(`<infDPS Id="${d.localId}">`);
    expect(d.requestXml).toContain("<Signature");
    // Clicou de novo: a mesma nota, sem outro envio nem outro número.
    expect(await emitNfse(c.id, s.caixaRecepcao, deps(st.transport))).toEqual({ id: r.id, status: "autorizada" });
    expect(st.posts()).toHaveLength(1);
    expect(await docsOf(c.id)).toHaveLength(1);
    expect((await db.select().from(fiscalSequences))[0]).toMatchObject({ kind: "nfse", environment: "teste", series: 1, nextNumber: 2 });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "nota_emitida"))).map((a) => a.entityId)).toEqual([c.id]);
  });

  it("dois cliques e o worker ao mesmo tempo: exatamente 1 envio e 1 nota", async () => {
    const c = await fechada();
    const st = stub({ post: [AUTORIZADA] });
    const d = deps(st.transport);
    const [a, b] = await Promise.all([emitNfse(c.id, s.caixaRecepcao, d), emitNfse(c.id, s.caixaRecepcao, d), processPendingNfse(d)]);
    expect(st.posts()).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(await docsOf(c.id)).toHaveLength(1);
    expect((await docsOf(c.id))[0].status).toBe("autorizada");
  });

  it("timeout e depois o worker: consulta a DPS, acha e marca autorizada SEM reenviar", async () => {
    const c = await fechada();
    const st = stub({ post: ["timeout"], get: [DPS_EXISTE] });
    expect((await emitNfse(c.id, s.caixaRecepcao, deps(st.transport))).status).toBe("pendente");
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ status: "pendente", attempts: 1, lastError: expect.stringContaining("tempo esgotado") });
    expect(d.nextTryAt).toEqual(new Date(clock.getTime() + 2 * 60_000)); // min(2^1, 30) min
    // Antes da hora, o worker não mexe.
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 0, rejeitadas: 0, falhas: 0 });
    later(3);
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 1, rejeitadas: 0, falhas: 0 });
    expect(st.posts()).toHaveLength(1); // nunca reenviou
    expect(st.gets().map((g) => g.url)).toEqual([`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/dps/${d.localId}`]);
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "autorizada", accessKey: CHAVE, lastError: null, nextTryAt: null });
  });

  it("timeout e DPS inexistente: reenvia o MESMO XML e o mesmo número", async () => {
    const c = await fechada();
    const st = stub({ post: ["timeout", AUTORIZADA], get: [DPS_NAO_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    later(3);
    expect((await processPendingNfse(deps(st.transport))).autorizadas).toBe(1);
    const [a, b] = st.posts().map((p) => ungz((p.body as { dpsXmlGZipB64: string }).dpsXmlGZipB64));
    expect(b).toBe(a);
    const [d] = await docsOf(c.id);
    expect(a).toBe(d.requestXml);
    expect(d).toMatchObject({ status: "autorizada", number: 1, attempts: 2 });
    expect(st.gets()).toHaveLength(1);
  });

  it("10 falhas viram erro_envio; 'Emitir de novo' cria número novo (depois de conferir que a anterior não saiu)", async () => {
    const c = await fechada();
    const st = stub({ post: ["timeout"], get: [DPS_NAO_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    for (let i = 0; i < 20; i++) { later(31); await processPendingNfse(deps(st.transport)); }
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ status: "erro_envio", attempts: 10, nextTryAt: null });
    expect(st.posts()).toHaveLength(10);
    const st2 = stub({ post: [AUTORIZADA], get: [DPS_NAO_EXISTE] });
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(st2.transport));
    expect(st2.gets().map((g) => g.url.endsWith(d.localId))).toEqual([true]); // conferiu a anterior antes de gastar número novo
    const docs = await docsOf(c.id);
    expect(docs.map((x) => [x.number, x.status])).toEqual([[1, "rejeitada"], [2, "autorizada"]]);
    expect(docs[0].rejectReason).toBe("Não saiu no governo (conferido antes de emitir de novo).");
    expect(r).toEqual({ id: docs[1].id, status: "autorizada" });
  });

  it("'Emitir de novo' depois de erro_envio: se a anterior saiu no governo, ela vira autorizada e não sai outra", async () => {
    const c = await fechada();
    await setSetting("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, tentativasMax: 1 });
    await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: ["timeout"] }).transport));
    expect((await docsOf(c.id))[0].status).toBe("erro_envio");
    const st = stub({ post: [AUTORIZADA], get: [DPS_EXISTE] });
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    expect(st.posts()).toHaveLength(0);
    expect(await docsOf(c.id)).toHaveLength(1);
    expect(r).toMatchObject({ status: "autorizada" });
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "autorizada", accessKey: CHAVE, number: 1 });
  });

  it("Regra do dono: tentativasMax e esperaMaxMin de Configurações mudam quando vira erro_envio e a espera", async () => {
    const c = await fechada();
    await setSetting("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, tentativasMax: 3, esperaMaxMin: 1 });
    const st = stub({ post: ["timeout"], get: [DPS_NAO_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    expect((await docsOf(c.id))[0].nextTryAt).toEqual(new Date(clock.getTime() + 60_000)); // min(2^1, 1) = 1 min
    later(2); await processPendingNfse(deps(st.transport));
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "pendente", attempts: 2 });
    later(2); await processPendingNfse(deps(st.transport));
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "erro_envio", attempts: 3 });
    expect(st.posts()).toHaveLength(3);
  });

  it("rejeitada mostra o motivo do governo", async () => {
    const c = await fechada();
    const st = stub({ post: [{ status: 400, json: { erros: [{ Codigo: "E0714", Descricao: "Assinatura inválida" }, { Codigo: "E0001", Descricao: "Outro problema" }] } }] });
    expect((await emitNfse(c.id, s.caixaRecepcao, deps(st.transport))).status).toBe("rejeitada");
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ status: "rejeitada", rejectReason: "Assinatura inválida (E0714) · Outro problema (E0001)", nextTryAt: null });
    // O worker não reenvia rejeitada.
    later(60);
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 0, rejeitadas: 0, falhas: 0 });
    expect(st.posts()).toHaveLength(1);
  });

  it("chave desligada: emitir dá o erro fixo e nada é gravado", async () => {
    const c = await fechada();
    await setSetting("nfse_modo", "desligada");
    const st = stub({ post: [AUTORIZADA] });
    await expect(emitNfse(c.id, s.caixaRecepcao, deps(st.transport))).rejects.toThrow("A nota fiscal está desligada em Configurações › Nota fiscal.");
    expect(await db.select().from(fiscalDocuments)).toHaveLength(0);
    expect(await db.select().from(fiscalSequences)).toHaveLength(0);
    expect(st.calls).toHaveLength(0);
  });

  it("comanda aberta ou sem serviço: erros fixos", async () => {
    const st = stub({ post: [AUTORIZADA] });
    const aberta = await comanda({ day: "2026-10-15", by: s.cati.id, status: "aberta", items: [{ label: "Corte", unitCents: 100, professionalId: s.bia.id }] });
    await expect(emitNfse(aberta.id, s.caixaRecepcao, deps(st.transport))).rejects.toThrow("Feche a comanda antes de emitir a nota.");
    const produto = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Shampoo", kind: "produto", unitCents: 4000, netCents: 4000 }] });
    await expect(emitNfse(produto.id, s.caixaRecepcao, deps(st.transport))).rejects.toThrow("Essa comanda não tem serviço para nota.");
    expect(st.calls).toHaveLength(0);
  });

  it("parceira sem CNPJ: emitir é recusado antes de gastar número", async () => {
    await db.update(professionals).set({ bond: "parceira", cnpj: null }).where(eq(professionals.id, s.bia.id));
    const c = await fechada(); // Corte da Bia, parceira sem CNPJ
    const st = stub({ post: [AUTORIZADA] });
    await expect(emitNfse(c.id, s.caixaRecepcao, deps(st.transport))).rejects.toThrow("A parceira Bia está sem CNPJ: cadastre antes de emitir a nota.");
    expect(await db.select().from(fiscalDocuments)).toHaveLength(0);
    expect(await db.select().from(fiscalSequences)).toHaveLength(0);
    expect(st.calls).toHaveLength(0);
  });

  it("Regra do dono: sem nota.emitir, emitir é recusado no servidor", async () => {
    const c = await fechada();
    const st = stub({ post: [AUTORIZADA] });
    await expect(emitNfse(c.id, { id: s.cati.id, perms: ["caixa.operar", "caixa.gerir"] }, deps(st.transport))).rejects.toThrow("Você não tem permissão para emitir nota fiscal.");
    expect(await db.select().from(fiscalDocuments)).toHaveLength(0);
  });

  it("Regra do dono: a assinatura segue fiscal_regras.assinaturaNfse e o pAliq segue informarAliquotaNaDps", async () => {
    const c = await fechada();
    await setSetting("fiscal_empresa", { ...EMPRESA, aliquotaIssBp: 500 });
    await setSetting("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, assinaturaNfse: "sha256", informarAliquotaNaDps: true });
    await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    const [d] = await docsOf(c.id);
    expect(d.requestXml).toContain("http://www.w3.org/2001/04/xmldsig-more#rsa-sha256");
    expect(d.requestXml).toContain("<pAliq>5.00</pAliq>");
  });

  it("certificado de outro CNPJ: recusa antes de gastar número", async () => {
    const c = await fechada();
    await setSetting("fiscal_empresa", { ...EMPRESA, cnpj: "11444777000161" });
    await expect(emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport))).rejects.toThrow("O certificado digital é de outro CNPJ (11.222.333/0001-81). Confira o CNPJ da Casa em Configurações › Nota fiscal.");
    expect(await db.select().from(fiscalSequences)).toHaveLength(0);
  });

  it("o worker com a chave desligada não envia nada (a nota fica na fila)", async () => {
    const c = await fechada();
    await db.transaction((tx) => queueNfseTx(tx, c.id, s.cati.id, clock, { cert }));
    await setSetting("nfse_modo", "desligada");
    const st = stub({ post: [AUTORIZADA] });
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 0, rejeitadas: 0, falhas: 0 });
    expect(st.calls).toHaveLength(0);
    await setSetting("nfse_modo", "teste");
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 1, rejeitadas: 0, falhas: 0 });
  });
});

describe("nota em dobro depois de envio incerto (I-1)", () => {
  const RECUSA: Answer = { status: 400, json: { erros: [{ Codigo: "E0999", Descricao: "Campo inválido" }] } };
  /** NÃO CONFIRMADO: o código da Sefin para DPS repetida; o texto basta para o CRM tratar como "já recebida". */
  const DUPLICADA: Answer = { status: 400, json: { erros: [{ Codigo: "E9998", Descricao: "DPS já existe para este identificador" }] } };

  it("timeout, a consulta ainda não acha (atraso) e o reenvio volta como DPS duplicada: não vira rejeitada; a consulta seguinte acha", async () => {
    const c = await fechada();
    const st = stub({ post: ["timeout", DUPLICADA], get: [DPS_NAO_EXISTE, DPS_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    later(3);
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 0, rejeitadas: 0, falhas: 1 });
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "pendente", attempts: 2, rejectReason: null, lastError: expect.stringContaining("já recebeu") });
    later(10);
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 1, rejeitadas: 0, falhas: 0 });
    expect(st.posts()).toHaveLength(2);
    expect(await docsOf(c.id)).toHaveLength(1);
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "autorizada", accessKey: CHAVE, number: 1 });
  });

  it("recusa depois de envio incerto: 'Emitir de novo' consulta a anterior; se ela saiu, vira autorizada e não sai outra", async () => {
    const c = await fechada();
    const st = stub({ post: ["timeout", RECUSA], get: [DPS_NAO_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    later(3); await processPendingNfse(deps(st.transport));
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ status: "rejeitada", attempts: 2 });
    const st2 = stub({ post: [AUTORIZADA], get: [DPS_EXISTE] });
    expect(await emitNfse(c.id, s.caixaRecepcao, deps(st2.transport))).toEqual({ id: d.id, status: "autorizada" });
    expect(st2.gets().map((g) => g.url.endsWith(d.localId))).toEqual([true]);
    expect(st2.posts()).toHaveLength(0);
    expect(await docsOf(c.id)).toHaveLength(1);
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "autorizada", accessKey: CHAVE, number: 1 });
    expect((await db.select().from(fiscalSequences))[0].nextNumber).toBe(2); // nenhum número novo
  });

  it("recusa depois de envio incerto e a anterior não saiu: ela fica 'Não saiu no governo (conferido antes de emitir de novo).', com auditoria de/para, e sai a nova", async () => {
    const c = await fechada();
    const st = stub({ post: ["timeout", RECUSA], get: [DPS_NAO_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    later(3); await processPendingNfse(deps(st.transport));
    const st2 = stub({ post: [AUTORIZADA], get: [DPS_NAO_EXISTE] });
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(st2.transport));
    const docs = await docsOf(c.id);
    expect(docs.map((x) => [x.number, x.status, x.rejectReason])).toEqual([[1, "rejeitada", "Não saiu no governo (conferido antes de emitir de novo)."], [2, "autorizada", null]]);
    expect(r).toEqual({ id: docs[1].id, status: "autorizada" });
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "nota_conferida"));
    expect(a).toMatchObject({ entityId: c.id, userId: s.cati.id });
    expect(a.data).toEqual({ tipo: "nfse", nota: 1, de: "rejeitada", para: "rejeitada", motivoAntes: "Campo inválido (E0999)", motivo: "Não saiu no governo (conferido antes de emitir de novo)." });
  });

  it("recusa no primeiro envio (sem incerteza): 'Emitir de novo' não consulta e gasta o número seguinte", async () => {
    const c = await fechada();
    await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [RECUSA] }).transport));
    later(1);
    const st = stub({ post: [AUTORIZADA], get: [DPS_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    expect(st.gets()).toHaveLength(0);
    expect((await docsOf(c.id)).map((x) => [x.number, x.status])).toEqual([[1, "rejeitada"], [2, "autorizada"]]);
  });
});

describe("Teste e Produção na mesma comanda (I-3)", () => {
  const OUTRA_CHAVE = "29274082112223330001810000000000000000000000000099";
  it("nota de Teste autorizada não é a nota viva em Produção: 'Emitir nota' gera a de Produção, e clicar de novo devolve a de Produção", async () => {
    const c = await fechada();
    const t = await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    await setSetting("nfse_modo", "producao");
    later(1); // a ordem das notas é pela criação
    const st = stub({ post: [{ status: 201, json: { chaveAcesso: OUTRA_CHAVE } }] });
    const p = await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    expect(p.id).not.toBe(t.id);
    expect(p.status).toBe("autorizada");
    const docs = await docsOf(c.id);
    expect(docs.map((x) => [x.environment, x.status, x.number])).toEqual([["teste", "autorizada", 1], ["producao", "autorizada", 1]]);
    expect(await emitNfse(c.id, s.caixaRecepcao, deps(st.transport))).toEqual({ id: p.id, status: "autorizada" });
    expect(st.posts()).toHaveLength(1);
  });
  it("em Produção, 'Emitir de novo' não consulta uma nota de Teste incerta", async () => {
    const c = await fechada();
    await setSetting("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, tentativasMax: 1 });
    await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: ["timeout"] }).transport));
    expect((await docsOf(c.id))[0]).toMatchObject({ environment: "teste", status: "erro_envio" });
    await setSetting("nfse_modo", "producao");
    later(1);
    const st = stub({ post: [AUTORIZADA], get: [DPS_EXISTE] });
    await emitNfse(c.id, s.caixaRecepcao, deps(st.transport));
    expect(st.gets()).toHaveLength(0);
    expect((await docsOf(c.id)).map((x) => [x.environment, x.status])).toEqual([["teste", "erro_envio"], ["producao", "autorizada"]]);
  });
  it("o bloco da comanda em Produção mostra a nota de Produção (a de Teste não ocupa o lugar)", async () => {
    const c = await fechada();
    await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    await setSetting("nfse_modo", "producao");
    expect((await loadNotaFiscalInfo(c.id)).documento).toBeNull();
  });
});

describe("emitir ao fechar", () => {
  async function fecharComServico() {
    const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Paula" }, s.caixaRecepcao, clock);
    await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, clock);
    await addPayment(w.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, clock);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, clock);
    return w.comandaId;
  }
  it("emitirAoFechar ligado: fechar a comanda deixa uma pendente; desligado, nada", async () => {
    vi.stubEnv("FISCAL_CERT_PATH", await writeTestPfx());
    vi.stubEnv("FISCAL_CERT_PASSWORD", TEST_PFX_PASSWORD);
    const sem = await fecharComServico();
    expect(await docsOf(sem)).toHaveLength(0); // padrão: emitirAoFechar desligado
    await setSetting("fiscal_empresa", { ...EMPRESA, emitirAoFechar: true });
    const com = await fecharComServico();
    const [d] = await docsOf(com);
    expect(d).toMatchObject({ status: "pendente", attempts: 0, amountCents: 12000, nextTryAt: null, createdBy: s.cati.id });
    expect(d.requestXml).toContain("<Signature");
    // O worker manda na próxima rodada.
    const st = stub({ post: [AUTORIZADA] });
    expect(await processPendingNfse(deps(st.transport))).toEqual({ autorizadas: 1, rejeitadas: 0, falhas: 0 });
  });
  it("r66: padrão 'Perguntar' sem escolha e emissão ligada: fechar é recusado; escolhida a nota, fecha", async () => {
    vi.stubEnv("FISCAL_CERT_PATH", await writeTestPfx());
    vi.stubEnv("FISCAL_CERT_PASSWORD", TEST_PFX_PASSWORD);
    await setSetting("caixa_regras", { notaPadrao: "perguntar" });
    await setSetting("fiscal_empresa", { ...EMPRESA, emitirAoFechar: true });
    const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Paula" }, s.caixaRecepcao, clock);
    await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, clock);
    await addPayment(w.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, clock);
    await expect(closeComanda(w.comandaId, {}, s.caixaRecepcao, clock)).rejects.toThrow("Escolha a nota fiscal antes de fechar a comanda.");
    await setComandaNota(w.comandaId, { escolha: "sem_cpf" }, s.caixaRecepcao, clock);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, clock);
    expect(await docsOf(w.comandaId)).toHaveLength(1);
  });
  it("emitirAoFechar ligado e algo errado na nota (sem certificado, só produto): a comanda fecha mesmo assim e o motivo fica na auditoria", async () => {
    vi.stubEnv("FISCAL_CERT_PATH", "");
    await setSetting("fiscal_empresa", { ...EMPRESA, emitirAoFechar: true });
    const id = await fecharComServico(); // sem certificado no servidor
    expect((await db.select().from(comandas).where(eq(comandas.id, id)))[0].status).toBe("fechada");
    expect(await docsOf(id)).toHaveLength(0);
    const [a] = await db.select().from(auditLog).where(and(eq(auditLog.action, "nota_nao_enviada"), eq(auditLog.entityId, id)));
    expect(a.data).toMatchObject({ motivo: "Instale o certificado digital A1 no servidor antes de emitir a nota." });
  });
});

describe("emitir ao fechar: a nota nunca derruba o fechamento", () => {
  it("CNPJ da Casa inválido com emitirAoFechar: a comanda fecha e não fica nota pendente", async () => {
    vi.stubEnv("FISCAL_CERT_PATH", await writeTestPfx());
    vi.stubEnv("FISCAL_CERT_PASSWORD", TEST_PFX_PASSWORD);
    await setSetting("fiscal_empresa", { ...EMPRESA, cnpj: "11222333000100", emitirAoFechar: true });
    const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Paula" }, s.caixaRecepcao, clock);
    await addItem(w.comandaId, { kind: "servico", serviceId: s.corte.id, professionalId: s.ana.id }, s.caixaRecepcao, clock);
    await addPayment(w.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, clock);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, clock);
    expect((await db.select().from(comandas).where(eq(comandas.id, w.comandaId)))[0].status).toBe("fechada");
    expect(await docsOf(w.comandaId)).toHaveLength(0);
    const [a] = await db.select().from(auditLog).where(and(eq(auditLog.action, "nota_nao_enviada"), eq(auditLog.entityId, w.comandaId)));
    expect(a.data).toMatchObject({ motivo: "Preencha o CNPJ da Casa em Configurações › Nota fiscal." });
  });
});

describe("cancelar nota", () => {
  it("cancelar nota: motivo curto recusado; sem nota.cancelar recusado; ok vira cancelada", async () => {
    const c = await fechada();
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    const st = stub({ post: [{ status: 201, json: { eventoXmlGZipB64: gz("<evento/>") } }] });
    await expect(cancelNfse(r.id, { reason: "curto" }, s.caixaGestao, deps(st.transport))).rejects.toThrow("Escreva o motivo do cancelamento (pelo menos 15 letras).");
    // caixa.gerir não basta: cancelar nota é nota.cancelar.
    await expect(cancelNfse(r.id, { reason: "Serviço lançado na cliente errada" }, { id: s.cati.id, perms: ["caixa.operar", "caixa.gerir", "nota.emitir"] }, deps(st.transport)))
      .rejects.toThrow("Você não tem permissão para cancelar nota fiscal.");
    expect(st.calls).toHaveLength(0);
    await cancelNfse(r.id, { reason: "Serviço lançado na cliente errada" }, s.caixaGestao, deps(st.transport));
    expect(st.calls[0].url).toBe(`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse/${CHAVE}/eventos`);
    const ev = ungz((st.calls[0].body as { pedidoRegistroEventoXmlGZipB64: string }).pedidoRegistroEventoXmlGZipB64);
    expect(ev).toContain(`<infPedReg Id="PRE${CHAVE}101101">`);
    expect(ev).toContain("<xMotivo>Serviço lançado na cliente errada</xMotivo>");
    expect(ev).toContain("<Signature");
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "cancelada", cancelledBy: s.gestora.id, cancelReason: "Serviço lançado na cliente errada", cancelledAt: clock });
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "nota_cancelada"));
    expect(a.data).toMatchObject({ de: "autorizada", para: "cancelada", motivo: "Serviço lançado na cliente errada" });
  });
  it("duplo clique em Cancelar: um evento só; o segundo recebe 'Essa nota já foi cancelada.'", async () => {
    const c = await fechada();
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    const st = stub({ post: [{ status: 201, json: {} }] });
    await cancelNfse(r.id, { reason: "Serviço lançado na cliente errada" }, s.caixaGestao, deps(st.transport));
    await expect(cancelNfse(r.id, { reason: "Serviço lançado na cliente errada" }, s.caixaGestao, deps(st.transport))).rejects.toThrow("Essa nota já foi cancelada.");
    expect(st.posts()).toHaveLength(1);
  });
  it("com a chave desligada, a nota autorizada ainda se cancela (no ambiente da própria nota)", async () => {
    const c = await fechada();
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    await setSetting("nfse_modo", "desligada");
    const st = stub({ post: [{ status: 201, json: {} }] });
    await cancelNfse(r.id, { reason: "Serviço lançado na cliente errada" }, s.caixaGestao, deps(st.transport));
    expect(st.calls[0].url).toContain("sefin.producaorestrita.nfse.gov.br");
    expect((await docsOf(c.id))[0].status).toBe("cancelada");
  });
  it("o governo recusa o cancelamento: a nota continua autorizada e o motivo aparece", async () => {
    const c = await fechada();
    const r = await emitNfse(c.id, s.caixaRecepcao, deps(stub({ post: [AUTORIZADA] }).transport));
    const st = stub({ post: [{ status: 400, json: { erros: [{ Codigo: "E1234", Descricao: "Prazo de cancelamento encerrado" }] } }] });
    await expect(cancelNfse(r.id, { reason: "Serviço lançado na cliente errada" }, s.caixaGestao, deps(st.transport))).rejects.toThrow("O governo não cancelou a nota: Prazo de cancelamento encerrado (E1234)");
    expect((await docsOf(c.id))[0].status).toBe("autorizada");
  });
});
