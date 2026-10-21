import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignedXml } from "xml-crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, comandaPayments, comandas, fiscalDocuments, fiscalSequences, products } from "@/server/db/schema";
import { DEFAULT_FISCAL_EMPRESA, DEFAULT_FISCAL_REGRAS } from "@/lib/fiscal-settings";
import { resetDb } from "../../../../../test/db";
import { bahia, setSetting } from "../../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../../test/caixa-fixtures";
import { comanda } from "../../../../../test/financeiro-fixtures";
import { makeTestPfx, TEST_CERT_CNPJ, TEST_PFX_PASSWORD, writeTestPfx } from "../../../../../test/fiscal-cert";
import { readPfx } from "../certificate";
import { createSefinClient, type SefinTransport } from "../sefin-client";
import { emitNfse, type NfseDeps } from "../nfse";
import { addItem, addPayment, cancelComanda, closeComanda, openWalkInComanda, reopenComanda, reopenForCorrection } from "../../caixa/comandas";
import { createSvrsClient, type SvrsTransport } from "./soap";
import { cancelNfce, emitNfce, processPendingNfce, queueNfceTx, type NfceDeps } from "./nfce";
import { resolverNotaForaDoCrm } from "../resolver";

/** CSC FICTÍCIO, só destes testes (o de verdade fica no .env do servidor). */
const CSC_DE_TESTE = "CSC0TESTE0CASA0FIAES0000000000000000";
const EMPRESA = {
  ...DEFAULT_FISCAL_EMPRESA, cnpj: TEST_CERT_CNPJ, razaoSocial: "Casa Fiaes Ltda", inscricaoMunicipal: "123456", inscricaoEstadual: "123456789", regime: "simples",
  endereco: { logradouro: "Rua das Flores", numero: "10", bairro: "Pituba", cep: "41810000" },
};

type Req = Parameters<SvrsTransport>[0];
type Answer = "100" | "204" | "778" | "timeout" | "217" | "101" | "135" | "501";
const soap = (inner: string) => `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><nfeResultMsg>${inner}</nfeResultMsg></soap:Body></soap:Envelope>`;
const prot = (chave: string, cStat: string, xMotivo: string, at: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><chNFe>${chave}</chNFe><dhRecbto>${at}</dhRecbto><nProt>329260000124985</nProt><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
/** Autorização às 15:00 de 15/10 em Salvador (= o `clock` do teste). */
const DH_RECBTO = "2026-10-15T15:00:00-03:00";

/** SVRS de mentira (nunca a SEFAZ): responde pela fila de cada serviço; a última resposta de cada fila se repete. */
function svrs(o: { autorizar?: Answer[]; consultar?: Answer[]; evento?: Answer[] }) {
  const calls: Req[] = [];
  const q = { autorizar: [...(o.autorizar ?? [])], consultar: [...(o.consultar ?? [])], evento: [...(o.evento ?? [])] };
  const next = (a: Answer[]) => (a.length > 1 ? a.shift()! : a[0]);
  const transport: SvrsTransport = async (r) => {
    calls.push(r);
    const svc = r.action.endsWith("nfeAutorizacaoLote") ? "autorizar" : r.action.endsWith("nfeConsultaNF") ? "consultar" : "evento";
    const a = next(q[svc]);
    if (!a) throw new Error("sem resposta no stub");
    if (a === "timeout") throw new Error("tempo esgotado (30 s)");
    const chave = r.body.match(/<infNFe Id="NFe([0-9]{44})"/)?.[1] ?? r.body.match(/<chNFe>([0-9]{44})<\/chNFe>/)?.[1] ?? "";
    if (svc === "autorizar") {
      const m = a === "100" ? "Autorizado o uso da NF-e" : a === "204" ? "Duplicidade de NF-e" : "Informado NCM inexistente";
      return { status: 200, body: soap(`<retEnviNFe versao="4.00"><cStat>104</cStat><xMotivo>Lote processado</xMotivo>${prot(chave, a, m, DH_RECBTO)}</retEnviNFe>`) };
    }
    if (svc === "consultar") {
      if (a === "217") return { status: 200, body: soap("<retConsSitNFe><cStat>217</cStat><xMotivo>NF-e nao consta na base de dados da SEFAZ</xMotivo></retConsSitNFe>") };
      if (a === "101") return { status: 200, body: soap("<retConsSitNFe><cStat>101</cStat><xMotivo>Cancelamento de NF-e homologado</xMotivo></retConsSitNFe>") };
      return { status: 200, body: soap(`<retConsSitNFe><cStat>100</cStat><xMotivo>Autorizado o uso da NF-e</xMotivo>${prot(chave, "100", "Autorizado o uso da NF-e", DH_RECBTO)}</retConsSitNFe>`) };
    }
    const ev = a === "135" ? "<cStat>135</cStat><xMotivo>Evento registrado e vinculado a NF-e</xMotivo>" : "<cStat>501</cStat><xMotivo>Prazo de cancelamento superior ao previsto na Legislacao</xMotivo>";
    return { status: 200, body: soap(`<retEnvEvento><cStat>128</cStat><retEvento versao="1.00"><infEvento>${ev}<nProt>329260000200001</nProt></infEvento></retEvento></retEnvEvento>`) };
  };
  const of = (svc: string) => calls.filter((c) => c.action.endsWith(svc));
  return { calls, transport, autorizacoes: () => of("nfeAutorizacaoLote"), consultas: () => of("nfeConsultaNF"), eventos: () => of("nfeRecepcaoEvento") };
}

const cert = readPfx(makeTestPfx(), TEST_PFX_PASSWORD);
/** Confere a assinatura como a SEFAZ faria: só com a chave pública do certificado. */
function assinaturaConfere(signed: string): boolean {
  const v = new SignedXml({ publicCert: cert.certPem });
  v.loadSignature(signed.match(/<Signature[\s\S]*<\/Signature>/)![0]);
  return v.checkSignature(signed);
}
let clock: Date;
const deps = (transport: SvrsTransport): NfceDeps => ({ client: createSvrsClient({ environment: "teste", transport }), cert, now: () => clock });
const later = (min: number) => { clock = new Date(clock.getTime() + min * 60_000); };
const docsOf = (comandaId: string, kind = "nfce") => db.select().from(fiscalDocuments).where(and(eq(fiscalDocuments.comandaId, comandaId), eq(fiscalDocuments.kind, kind))).orderBy(fiscalDocuments.createdAt);

let s: Awaited<ReturnType<typeof setupCaixa>>;
let shampoo: typeof products.$inferSelect;
beforeEach(async () => {
  await resetDb(); s = await setupCaixa();
  await setSetting("caixa_regras", { notaPadrao: "sem_cpf" }); // o padrão novo é Perguntar; estes testes fecham sem escolher a nota
  clock = bahia(15, 15);
  await setSetting("nfce_modo", "teste");
  await setSetting("fiscal_empresa", EMPRESA);
  vi.stubEnv("NFCE_CSC", CSC_DE_TESTE);
  vi.stubEnv("NFCE_CSC_ID", "000001");
  [shampoo] = await db.insert(products).values({ name: "Shampoo Nutritivo", ncm: "33051000", cfop: "5102", csosn: "102", unit: "UN", priceCents: 4590 }).returning();
});
afterEach(() => { vi.unstubAllEnvs(); });

/** Comanda fechada com um Shampoo de R$ 45,90 pago no Pix. */
const fechada = async (o: { netCents?: number; productId?: string | null; label?: string } = {}) => comanda({
  day: "2026-10-15", by: s.cati.id, clientName: "Paula", pays: [{ method: "pix", valueCents: o.netCents ?? 4590 }],
  items: [{ label: o.label ?? "Shampoo Nutritivo", kind: "produto", unitCents: o.netCents ?? 4590, productId: o.productId === undefined ? shampoo.id : o.productId, netCents: o.netCents ?? 4590 }],
});

describe("emitir a NFC-e pela comanda", () => {
  it("autorizada: chave de 44 números, QR Code com o CSC, assinatura SHA-1, nfeProc guardado; clicar de novo não manda outra", async () => {
    const c = await fechada();
    const st = svrs({ autorizar: ["100"] });
    const r = await emitNfce(c.id, s.caixaRecepcao, deps(st.transport));
    expect(r.status).toBe("autorizada");
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ id: r.id, kind: "nfce", environment: "teste", series: 1, number: 1, status: "autorizada", amountCents: 4590, attempts: 1 });
    expect(d.accessKey).toMatch(/^29261011222333000181650010000000011[0-9]{9}$/);
    expect(d.localId).toBe(`NFe${d.accessKey}`);
    expect(d.authorizedAt).toEqual(new Date(DH_RECBTO));
    expect(d.requestXml).toContain(`<infNFe Id="NFe${d.accessKey}" versao="4.00">`);
    expect(d.requestXml).toContain("http://www.w3.org/2000/09/xmldsig#rsa-sha1");
    expect(d.requestXml).toMatch(/<\/infNFe><infNFeSupl><qrCode><!\[CDATA\[http:\/\/hnfe\.sefaz\.ba\.gov\.br\/servicos\/nfce\/qrcode\.aspx\?p=[0-9]{44}\|2\|2\|1\|[0-9A-F]{40}\]\]><\/qrCode>.*<\/infNFeSupl><Signature/);
    expect(d.requestXml).not.toContain(CSC_DE_TESTE); // o CSC só entra no hash
    // O infNFeSupl entrou depois de assinar e a assinatura (só sobre infNFe) continua conferindo.
    expect(assinaturaConfere(d.requestXml!)).toBe(true);
    expect(assinaturaConfere(d.requestXml!.replace("<vNF>45.90</vNF>", "<vNF>4.59</vNF>"))).toBe(false);
    expect(d.responseBody).toMatch(/^<nfeProc xmlns="http:\/\/www\.portalfiscal\.inf\.br\/nfe" versao="4\.00"><NFe .*<protNFe/);
    // O XML enviado é o guardado.
    expect(st.autorizacoes()[0].body).toContain(d.requestXml!);
    expect(await emitNfce(c.id, s.caixaRecepcao, deps(st.transport))).toEqual({ id: r.id, status: "autorizada" });
    expect(st.autorizacoes()).toHaveLength(1);
    expect((await db.select().from(fiscalSequences))[0]).toMatchObject({ kind: "nfce", environment: "teste", series: 1, nextNumber: 2 });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "nota_emitida"));
    expect(audits.map((a) => a.data)).toEqual([expect.objectContaining({ tipo: "nfce", nota: 1, status: "autorizada" })]);
  });

  it("Regra do dono: NFC-e desligada recusa com a frase própria e não grava nada", async () => {
    await setSetting("nfce_modo", "desligada");
    const c = await fechada();
    const st = svrs({ autorizar: ["100"] });
    await expect(emitNfce(c.id, s.caixaRecepcao, deps(st.transport))).rejects.toThrow("A NFC-e está desligada em Configurações › Nota fiscal.");
    expect(st.calls).toHaveLength(0);
    expect(await docsOf(c.id)).toHaveLength(0);
    expect(await db.select().from(fiscalSequences)).toHaveLength(0);
    // O worker também não envia nada com a chave desligada.
    await setSetting("nfce_modo", "teste");
    await db.transaction((tx) => queueNfceTx(tx, c.id, s.cati.id, clock, { cert }));
    await setSetting("nfce_modo", "desligada");
    expect(await processPendingNfce(deps(st.transport))).toEqual({ autorizadas: 0, rejeitadas: 0, falhas: 0 });
    expect(st.calls).toHaveLength(0);
  });

  it("Regra do dono: sem nota.emitir, recusa no servidor (caixa.operar e caixa.gerir não bastam)", async () => {
    const c = await fechada();
    const st = svrs({ autorizar: ["100"] });
    await expect(emitNfce(c.id, { id: s.cati.id, perms: ["caixa.operar", "caixa.gerir", "nota.ver"] }, deps(st.transport))).rejects.toThrow("Você não tem permissão para emitir nota fiscal.");
    expect(st.calls).toHaveLength(0);
    expect(await docsOf(c.id)).toHaveLength(0);
  });

  it("produto sem NCM: erro fixo, sem gastar número", async () => {
    await db.update(products).set({ ncm: null }).where(eq(products.id, shampoo.id));
    const c = await fechada();
    await expect(emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport))).rejects.toThrow("Produto Shampoo Nutritivo sem NCM: complete em Serviços e pacotes › Produtos.");
    // Produto lançado como texto livre (sem cadastro) também não tem NCM.
    const livre = await fechada({ productId: null, label: "Kit avulso" });
    await expect(emitNfce(livre.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport))).rejects.toThrow("Produto Kit avulso sem NCM: complete em Serviços e pacotes › Produtos.");
    expect(await db.select().from(fiscalSequences)).toHaveLength(0);
  });

  it("sem o CSC no servidor: recusa com frase", async () => {
    vi.stubEnv("NFCE_CSC", "");
    const c = await fechada();
    await expect(emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport))).rejects.toThrow("Coloque o CSC da SEFAZ-BA no servidor (NFCE_CSC e NFCE_CSC_ID) antes de emitir a NFC-e.");
  });

  it("produto 100% em cortesia: frase própria, sem gastar número", async () => {
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, pays: [{ method: "cortesia", valueCents: 4590 }],
      items: [{ label: "Shampoo Nutritivo", kind: "produto", unitCents: 4590, productId: shampoo.id, netCents: 0 }] });
    await expect(emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport))).rejects.toThrow("Produto dado como cortesia não sai na NFC-e: emita a nota só se houver produto pago.");
    expect(await db.select().from(fiscalSequences)).toHaveLength(0);
  });

  it("comanda só com serviço: 'Essa comanda não tem produto para nota.'", async () => {
    const c = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Corte", unitCents: 12000, netCents: 12000 }] });
    await expect(emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport))).rejects.toThrow("Essa comanda não tem produto para nota.");
  });

  it("comanda com serviço e produto: duas notas (NFS-e e NFC-e), cada uma com o próprio valor; <pag> rateado sem a cortesia nem o troco", async () => {
    await setSetting("nfse_modo", "teste");
    const c = await comanda({
      day: "2026-10-15", by: s.cati.id, clientName: "Paula", changeCents: 1000,
      items: [{ label: "Corte", unitCents: 12150, professionalId: s.bia.id, netCents: 12150 }, { label: "Shampoo Nutritivo", kind: "produto", unitCents: 4590, productId: shampoo.id, netCents: 4590 }],
      pays: [{ method: "pix", valueCents: 10000 }, { method: "dinheiro", valueCents: 7740 }, { method: "cortesia", valueCents: 500 }],
    });
    const sefin: SefinTransport = async () => ({ status: 201, json: { chaveAcesso: "29274082112223330001810000000000000000000000000042" } });
    const nfseDeps: NfseDeps = { client: createSefinClient({ environment: "teste", transport: sefin }), cert, now: () => clock };
    await emitNfse(c.id, s.caixaRecepcao, nfseDeps);
    const st = svrs({ autorizar: ["100"] });
    await emitNfce(c.id, s.caixaRecepcao, deps(st.transport));
    const [nfse] = await docsOf(c.id, "nfse"), [nfce] = await docsOf(c.id, "nfce");
    expect(nfse).toMatchObject({ status: "autorizada", amountCents: 12150 });
    expect(nfce).toMatchObject({ status: "autorizada", amountCents: 4590 });
    expect(nfse.requestXml).not.toContain("Shampoo");
    expect(nfce.requestXml).not.toContain("Corte");
    // 4590 rateado por Pix 10000 e dinheiro 6740 (7740 − 1000 de troco): 2742 + 1848; a cortesia fica de fora.
    const pag = nfce.requestXml!.match(/<pag>.*<\/pag>/)![0];
    expect(pag).toBe("<pag><detPag><indPag>0</indPag><tPag>17</tPag><vPag>27.42</vPag><card><tpIntegra>2</tpIntegra></card></detPag><detPag><indPag>0</indPag><tPag>01</tPag><vPag>18.48</vPag></detPag></pag>");
    expect(nfce.requestXml).toContain("<vNF>45.90</vNF>");
  });

  it("cartão: grupo card com tpIntegra 2 e a bandeira da comanda", async () => {
    const c = await fechada();
    await db.update(comandaPayments).set({ method: "credito", brand: "mastercard" }).where(eq(comandaPayments.comandaId, c.id));
    await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    expect((await docsOf(c.id))[0].requestXml).toContain("<detPag><indPag>0</indPag><tPag>03</tPag><vPag>45.90</vPag><card><tpIntegra>2</tpIntegra><tBand>02</tBand></card></detPag>");
  });

  it("recusa da SEFAZ: rejeitada com o motivo; 'Emitir de novo' gasta outro número", async () => {
    const c = await fechada();
    const r = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["778"] }).transport));
    expect(r.status).toBe("rejeitada");
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "rejeitada", rejectReason: "Informado NCM inexistente (cStat 778)" });
    expect((await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport))).status).toBe("autorizada");
    expect((await docsOf(c.id)).map((d) => [d.number, d.status])).toEqual([[1, "rejeitada"], [2, "autorizada"]]);
  });
});

describe("a fila sem duplicar (mesma disciplina da NFS-e)", () => {
  it("timeout e depois o worker: consulta pela chave, acha e marca autorizada SEM reenviar", async () => {
    const c = await fechada();
    const st = svrs({ autorizar: ["timeout"], consultar: ["100"] });
    expect((await emitNfce(c.id, s.caixaRecepcao, deps(st.transport))).status).toBe("pendente");
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ status: "pendente", attempts: 1, lastError: expect.stringContaining("tempo esgotado") });
    expect(await processPendingNfce(deps(st.transport))).toEqual({ autorizadas: 0, rejeitadas: 0, falhas: 0 }); // antes da hora
    later(3);
    expect(await processPendingNfce(deps(st.transport))).toEqual({ autorizadas: 1, rejeitadas: 0, falhas: 0 });
    expect(st.autorizacoes()).toHaveLength(1);
    expect(st.consultas()[0].body).toContain(`<chNFe>${d.localId.slice(3)}</chNFe>`);
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "autorizada", accessKey: d.localId.slice(3), lastError: null, nextTryAt: null });
    expect((await docsOf(c.id))[0].responseBody).toContain("<protNFe");
  });

  it("timeout e a chave não consta (217): reenvia o MESMO XML", async () => {
    const c = await fechada();
    const st = svrs({ autorizar: ["timeout", "100"], consultar: ["217"] });
    await emitNfce(c.id, s.caixaRecepcao, deps(st.transport));
    later(3);
    expect((await processPendingNfce(deps(st.transport))).autorizadas).toBe(1);
    const [a, b] = st.autorizacoes().map((x) => x.body);
    expect(b).toBe(a);
    expect((await docsOf(c.id))[0]).toMatchObject({ status: "autorizada", number: 1, attempts: 2 });
  });

  it("dois cliques e o worker ao mesmo tempo: 1 envio e 1 nota", async () => {
    const c = await fechada();
    const st = svrs({ autorizar: ["100"] });
    const d = deps(st.transport);
    const [a, b] = await Promise.all([emitNfce(c.id, s.caixaRecepcao, d), emitNfce(c.id, s.caixaRecepcao, d), processPendingNfce(d)]);
    expect(st.autorizacoes()).toHaveLength(1);
    expect(a.id).toBe(b.id);
    expect(await docsOf(c.id)).toHaveLength(1);
  });
});

describe("Teste e Produção na mesma comanda (I-3)", () => {
  it("NFC-e de Teste autorizada não é a nota viva em Produção nem segura a comanda", async () => {
    const c = await fechada();
    const t = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    await setSetting("nfce_modo", "producao");
    later(1); // a ordem das notas é pela criação
    const p = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    expect(p.id).not.toBe(t.id);
    expect((await docsOf(c.id)).map((d) => [d.environment, d.status])).toEqual([["teste", "autorizada"], ["producao", "autorizada"]]);
  });
});

describe("cancelar a NFC-e", () => {
  const MOTIVO = "Produto lançado na cliente errada";
  it("dentro do prazo: evento 110111 assinado com o protocolo; a nota vira cancelada com auditoria de/para", async () => {
    const c = await fechada();
    const r = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    later(29);
    const st = svrs({ evento: ["135"] });
    await expect(cancelNfce(r.id, { reason: "curto" }, s.caixaGestao, deps(st.transport))).rejects.toThrow("Escreva o motivo do cancelamento (pelo menos 15 letras).");
    await cancelNfce(r.id, { reason: MOTIVO }, s.caixaGestao, deps(st.transport));
    const ev = st.eventos()[0].body;
    expect(ev).toContain("<tpEvento>110111</tpEvento>");
    expect(ev).toContain("<nProt>329260000124985</nProt>");
    expect(ev).toContain(`<xJust>${MOTIVO}</xJust>`);
    expect(ev).toContain("<Signature");
    expect(assinaturaConfere(ev.match(/<evento [\s\S]*<\/evento>/)![0])).toBe(true);
    const [d] = await docsOf(c.id);
    expect(d).toMatchObject({ status: "cancelada", cancelledBy: s.gestora.id, cancelReason: MOTIVO, cancelledAt: clock });
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "nota_cancelada"));
    expect(a.data).toMatchObject({ tipo: "nfce", de: "autorizada", para: "cancelada", motivo: MOTIVO });
    await expect(cancelNfce(r.id, { reason: MOTIVO }, s.caixaGestao, deps(st.transport))).rejects.toThrow("Essa nota já foi cancelada.");
    expect(st.eventos()).toHaveLength(1);
  });

  it("depois de 30 minutos: recusa sem falar com a SEFAZ", async () => {
    const c = await fechada();
    const r = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    later(31);
    const st = svrs({ evento: ["135"] });
    await expect(cancelNfce(r.id, { reason: MOTIVO }, s.caixaGestao, deps(st.transport))).rejects.toThrow("A NFC-e só pode ser cancelada até 30 minutos depois de autorizada.");
    expect(st.calls).toHaveLength(0);
    expect((await docsOf(c.id))[0].status).toBe("autorizada");
  });

  it("Regra do dono: o prazo vem de fiscal_regras.nfceCancelarAteMin", async () => {
    const c = await fechada();
    const r = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    later(11);
    await setSetting("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, nfceCancelarAteMin: 10 });
    await expect(cancelNfce(r.id, { reason: MOTIVO }, s.caixaGestao, deps(svrs({ evento: ["135"] }).transport))).rejects.toThrow("A NFC-e só pode ser cancelada até 10 minutos depois de autorizada.");
    await setSetting("fiscal_regras", { ...DEFAULT_FISCAL_REGRAS, nfceCancelarAteMin: 60 });
    await cancelNfce(r.id, { reason: MOTIVO }, s.caixaGestao, deps(svrs({ evento: ["135"] }).transport));
    expect((await docsOf(c.id))[0].status).toBe("cancelada");
  });

  it("Regra do dono: sem nota.cancelar, recusa no servidor; a recusa da SEFAZ mantém a nota autorizada", async () => {
    const c = await fechada();
    const r = await emitNfce(c.id, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    const st = svrs({ evento: ["501"] });
    await expect(cancelNfce(r.id, { reason: MOTIVO }, { id: s.cati.id, perms: ["caixa.operar", "caixa.gerir", "nota.emitir"] }, deps(st.transport))).rejects.toThrow("Você não tem permissão para cancelar nota fiscal.");
    expect(st.calls).toHaveLength(0);
    await expect(cancelNfce(r.id, { reason: MOTIVO }, s.caixaGestao, deps(st.transport))).rejects.toThrow("A SEFAZ não cancelou a NFC-e: O prazo legal para cancelar esta nota já passou.");
    expect((await docsOf(c.id))[0].status).toBe("autorizada");
  });
});

describe("as três portas da comanda também conferem a NFC-e", () => {
  const reabrir = (id: string, d?: NfceDeps) => reopenComanda(id, { reason: "esqueceu o produto" }, s.caixaGestao, clock, d && { nfce: d });
  const corrigir = (id: string, d?: NfceDeps) => reopenForCorrection(id, { reason: "corrigir preço" }, s.caixaGestao, clock, d && { nfce: d });
  const cancelar = (id: string, d?: NfceDeps) => cancelComanda(id, { reason: "lançada errada" }, s.caixaGestao, clock, d && { nfce: d });
  const statusOf = async (id: string) => (await db.select().from(comandas).where(eq(comandas.id, id)))[0].status;
  const nota = async (comandaId: string, status: string, attempts = 0) => (await db.insert(fiscalDocuments).values({
    comandaId, kind: "nfce", environment: "teste", series: 1, number: Math.floor(Math.random() * 1e8) + 1, localId: "NFe29261011222333000181650010000000071123456780",
    status, attempts, amountCents: 4590, accessKey: status === "autorizada" ? "29261011222333000181650010000000071123456780" : null,
  }).returning())[0];
  async function fechadaDeVerdade() {
    const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Paula" }, s.caixaRecepcao, clock);
    await addItem(w.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao, clock);
    await addPayment(w.comandaId, { method: "pix", valueCents: 4590 }, s.caixaRecepcao, clock);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, clock);
    return w.comandaId;
  }

  it("NFC-e autorizada segura as três portas", async () => {
    const id = await fechadaDeVerdade();
    await nota(id, "autorizada");
    for (const porta of [reabrir, corrigir, cancelar]) await expect(porta(id)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
    expect(await statusOf(id)).toBe("fechada");
  });

  it("NFC-e incerta (erro_envio): consulta pela chave; não consta → rejeitada e a comanda reabre; consta → autorizada e recusa", async () => {
    const id = await fechadaDeVerdade();
    const n = await nota(id, "erro_envio", 10);
    const st = svrs({ consultar: ["217"] });
    await reabrir(id, deps(st.transport));
    expect(st.consultas()).toHaveLength(1);
    expect(await statusOf(id)).toBe("aberta");
    expect((await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, n.id)))[0]).toMatchObject({ status: "rejeitada", rejectReason: "Não saiu no governo (conferido antes de reabrir a comanda)." });

    // 101: saiu e foi cancelada fora do CRM → a nota fica cancelada e a comanda reabre.
    const id3 = await fechadaDeVerdade();
    const n3 = await nota(id3, "erro_envio", 10);
    await reabrir(id3, deps(svrs({ consultar: ["101"] }).transport));
    expect(await statusOf(id3)).toBe("aberta");
    expect((await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, n3.id)))[0]).toMatchObject({ status: "cancelada", cancelReason: "Cancelada fora do CRM (conferido no governo)." });

    const id2 = await fechadaDeVerdade();
    const n2 = await nota(id2, "erro_envio", 10);
    await expect(cancelar(id2, deps(svrs({ consultar: ["100"] }).transport))).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
    expect((await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, n2.id)))[0]).toMatchObject({ status: "autorizada", accessKey: n2.localId.slice(3) });
  });
});

describe("NFC-e fora do prazo não prende a comanda (I-2)", () => {
  it("autorizada há mais de N minutos: cancelar na SEFAZ é recusado; 'Resolver fora do CRM' (Gestão) libera cancelar a comanda", async () => {
    const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Paula" }, s.caixaRecepcao, clock);
    await addItem(w.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao, clock);
    await addPayment(w.comandaId, { method: "pix", valueCents: 4590 }, s.caixaRecepcao, clock);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, clock);
    const r = await emitNfce(w.comandaId, s.caixaRecepcao, deps(svrs({ autorizar: ["100"] }).transport));
    later(31);
    await expect(cancelNfce(r.id, { reason: "Produto lançado errado na comanda" }, s.caixaGestao, deps(svrs({ evento: ["135"] }).transport))).rejects.toThrow("A NFC-e só pode ser cancelada até 30 minutos depois de autorizada.");
    await expect(cancelComanda(w.comandaId, { reason: "lançada errada" }, s.caixaGestao, clock)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
    await resolverNotaForaDoCrm(r.id, { escolha: "saiu_resolvida", motivo: "Nota de devolução emitida pelo contador" }, s.caixaGestao, clock);
    await cancelComanda(w.comandaId, { reason: "lançada errada" }, s.caixaGestao, clock);
    expect((await db.select().from(comandas).where(eq(comandas.id, w.comandaId)))[0].status).toBe("cancelada");
  });
});

describe("emitir ao fechar", () => {
  it("emitirAoFechar ligado e a NFC-e ligada: fechar a comanda com produto deixa uma NFC-e pendente; o worker envia", async () => {
    vi.stubEnv("FISCAL_CERT_PATH", await writeTestPfx());
    vi.stubEnv("FISCAL_CERT_PASSWORD", TEST_PFX_PASSWORD);
    await setSetting("fiscal_empresa", { ...EMPRESA, emitirAoFechar: true });
    const w = await openWalkInComanda({ requestKey: randomUUID(), clientName: "Paula" }, s.caixaRecepcao, clock);
    await addItem(w.comandaId, { kind: "produto", productId: shampoo.id }, s.caixaRecepcao, clock);
    await addPayment(w.comandaId, { method: "pix", valueCents: 4590 }, s.caixaRecepcao, clock);
    await closeComanda(w.comandaId, {}, s.caixaRecepcao, clock);
    const [d] = await docsOf(w.comandaId);
    expect(d).toMatchObject({ status: "pendente", attempts: 0, amountCents: 4590 });
    expect(await docsOf(w.comandaId, "nfse")).toHaveLength(0); // NFS-e desligada (padrão) e sem serviço
    expect(await processPendingNfce(deps(svrs({ autorizar: ["100"] }).transport))).toEqual({ autorizadas: 1, rejeitadas: 0, falhas: 0 });
  });
});
