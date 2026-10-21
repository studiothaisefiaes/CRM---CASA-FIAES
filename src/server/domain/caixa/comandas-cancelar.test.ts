import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments, auditLog, clientPackages, comandaItems, comandas, fiscalDocuments, packageDefs, packageUses } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { makeTestPfx, TEST_PFX_PASSWORD } from "../../../../test/fiscal-cert";
import { readPfx } from "../fiscal/certificate";
import { createSefinClient, type SefinTransport } from "../fiscal/sefin-client";
import type { NfseDeps } from "../fiscal/nfse";
import { resolverNotaForaDoCrm } from "../fiscal/resolver";
import { bahia, cliente, NOW, setSetting } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { createVisit } from "../agenda/visits";
import { closeCash, openCash, reopenCash } from "./cash";
import { addCreditTx, creditBalance } from "./credits";
import { addItem, addPayment, cancelComanda, closeComanda, discardComanda, openComandaForAppointment, openWalkInComanda, reopenComanda, reopenForCorrection } from "./comandas";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

async function fechadaComTudo() {
  const p = await cliente("Paula Souza");
  await db.transaction((tx) => addCreditTx(tx, { contactId: p.contactId, deltaCents: 5000, reason: "troco" }, s.cati.id));
  const [cp] = await db.insert(clientPackages).values({ contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, unitCents: 10000, validUntil: "2027-01-01", externalKey: "t:1" }).returning();
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, bahia(15, 8));
  const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
  await addItem(c.comandaId, { kind: "pacote_sessao", clientPackageId: cp.id, professionalId: s.ana.id }, s.caixaRecepcao, NOW);
  await addPayment(c.comandaId, { method: "credito_cliente", valueCents: 2000 }, s.caixaRecepcao, NOW);
  await addPayment(c.comandaId, { method: "dinheiro", valueCents: 12000 }, s.caixaRecepcao, NOW);
  await closeComanda(c.comandaId, { saveChangeAsCredit: true }, s.caixaRecepcao, NOW); // 12.000 total; 2.000 de troco viram crédito
  return { p, cp, comandaId: c.comandaId, appointmentId: v.appointmentIds[0] };
}

it("descartar comanda aberta (sem motivo obrigatório); fechada não se descarta", async () => {
  const w = await openWalkInComanda({ requestKey: randomUUID() }, s.caixaRecepcao, NOW);
  await discardComanda(w.comandaId, s.caixaRecepcao, NOW);
  expect((await db.select().from(comandas).where(eq(comandas.id, w.comandaId)))[0]).toMatchObject({ status: "cancelada", cancelReason: "descartada" });
  const f = await fechadaComTudo();
  await expect(discardComanda(f.comandaId, s.caixaRecepcao, NOW)).rejects.toThrow("Comanda fechada: só a gestão cancela, com motivo.");
});

it("cancelar fechada: motivo obrigatório; desfaz sessão usada, crédito (estorno) e comissão; os horários não voltam sozinhos", async () => {
  const f = await fechadaComTudo();
  expect(await creditBalance(f.p.contactId)).toBe(5000); // 5.000 − 2.000 usado + 2.000 de troco
  await expect(cancelComanda(f.comandaId, { reason: " " }, s.caixaGestao, NOW)).rejects.toThrow("Escreva o motivo.");
  await cancelComanda(f.comandaId, { reason: "lançada na cliente errada" }, s.caixaGestao, NOW);
  expect((await db.select().from(comandas).where(eq(comandas.id, f.comandaId)))[0]).toMatchObject({ status: "cancelada", cancelReason: "lançada na cliente errada", cancelledBy: s.gestora.id });
  expect((await db.select().from(clientPackages).where(eq(clientPackages.id, f.cp.id)))[0].usedSessions).toBe(1);
  expect((await db.select().from(packageUses).where(eq(packageUses.clientPackageId, f.cp.id)))[0].cancelledAt).not.toBeNull();
  expect(await creditBalance(f.p.contactId)).toBe(5000 + 2000 - 2000); // estorno do usado (+2.000) e do troco guardado (−2.000)
  expect(await db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, f.comandaId), isNull(comandaItems.cancelledAt)))).toHaveLength(0);
  expect((await db.select().from(appointments).where(eq(appointments.id, f.appointmentId)))[0].status).toBe("compareceu");
});

it("cancelar exige o caixa de cada pagamento aberto; reabrir para corrigir abre uma nova com os mesmos itens", async () => {
  await openCash({ openingCents: 0 }, s.caixaRecepcao, NOW);
  const f = await fechadaComTudo();
  const [c] = await db.select().from(comandas).where(eq(comandas.id, f.comandaId));
  await closeCash({ cashBreakdown: { "10000": 1, "2000": 1 }, counted: {} }, s.caixaRecepcao, NOW);
  await expect(cancelComanda(f.comandaId, { reason: "erro" }, s.caixaGestao, NOW)).rejects.toThrow("Esse pagamento entrou no caixa de Cati, que já fechou.");
  await reopenCash(c.cashSessionId!, { reason: "corrigir a comanda" }, s.caixaGestao, NOW);
  const r = await reopenForCorrection(f.comandaId, { reason: "corrigir preço" }, s.caixaGestao, NOW);
  expect(r.number).toBe(2);
  const novos = await db.select().from(comandaItems).where(and(eq(comandaItems.comandaId, r.comandaId), isNull(comandaItems.cancelledAt))).orderBy(comandaItems.createdAt);
  expect(novos.map((i) => [i.kind, i.label, i.commissionCents])).toEqual([["servico", "Corte", null], ["pacote_sessao", "Corte (pacote)", null]]);
  expect((await db.select().from(comandas).where(eq(comandas.id, r.comandaId)))[0]).toMatchObject({ status: "aberta", visitId: c.visitId });
});

it("recusa cancelar quando o pacote vendido nela já teve sessão usada (o saldo ficaria errado)", async () => {
  const p = await cliente("Paula Souza");
  const [def] = await db.insert(packageDefs).values({ name: "Combo", priceCents: 40000, validityDays: 90, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: 10000 }] }).returning();
  const w = await openWalkInComanda({ requestKey: randomUUID(), contactId: p.contactId }, s.caixaRecepcao, NOW);
  await addItem(w.comandaId, { kind: "pacote_venda", packageDefId: def.id }, s.caixaRecepcao, NOW);
  await addPayment(w.comandaId, { method: "pix", valueCents: 40000 }, s.caixaRecepcao, NOW);
  await closeComanda(w.comandaId, {}, s.caixaRecepcao, NOW);
  await db.update(clientPackages).set({ usedSessions: 1 }).where(eq(clientPackages.origin, "crm"));
  await expect(cancelComanda(w.comandaId, { reason: "desistiu" }, s.caixaGestao, NOW)).rejects.toThrow("O pacote vendido nesta comanda já teve sessão usada: cancele a comanda dessa sessão antes.");
});

describe("nota fiscal na comanda (Fase D, Review Focus 1)", () => {
  const CHAVE = "29274082112223330001810000000000000000000000000042";
  const cert = readPfx(makeTestPfx(), TEST_PFX_PASSWORD);
  /** Sefin de mentira só para a consulta da DPS (nunca o governo de verdade). */
  const sefin = (get: { status: number; json: unknown } | "timeout") => {
    const calls: string[] = [];
    const transport: SefinTransport = async (r) => { calls.push(`${r.method} ${r.url}`); if (get === "timeout") throw new Error("tempo esgotado (30 s)"); return get; };
    const deps: NfseDeps = { client: createSefinClient({ environment: "teste", transport }), cert, now: () => NOW };
    return { calls, deps };
  };
  const EXISTE = { status: 200, json: { chaveAcesso: CHAVE } };
  const NAO_EXISTE = { status: 404, json: { erro: [{ Codigo: "E2404", Descricao: "Não foi gerada" }] } };
  // As notas daqui são de Teste: só seguram a comanda com a chave em Teste (I-3); a chave liga no beforeEach.
  beforeEach(async () => { await setSetting("nfse_modo", "teste"); });
  const nota = async (comandaId: string, status: string, attempts = 0, environment = "teste") =>
    (await db.insert(fiscalDocuments).values({ comandaId, kind: "nfse", environment, series: 1, number: Math.floor(Math.random() * 1e9) + 1, localId: `DPS2927408211222333000181000010000000${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
      status, attempts, amountCents: 12000, accessKey: status === "autorizada" ? CHAVE : null }).returning())[0];
  const docOf = async (id: string) => (await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id)))[0];
  const statusOf = async (id: string) => (await db.select().from(comandas).where(eq(comandas.id, id)))[0].status;
  const reabrir = (id: string, d?: NfseDeps) => reopenComanda(id, { reason: "esqueceu o produto" }, s.caixaGestao, NOW, d && { nfse: d });
  const corrigir = (id: string, d?: NfseDeps) => reopenForCorrection(id, { reason: "corrigir preço" }, s.caixaGestao, NOW, d && { nfse: d });
  const cancelar = (id: string, d?: NfseDeps) => cancelComanda(id, { reason: "lançada errada" }, s.caixaGestao, NOW, d && { nfse: d });

  it("reabrir, reabrir para correção e cancelar comanda com nota autorizada: erro fixo", async () => {
    const f = await fechadaComTudo();
    await nota(f.comandaId, "autorizada");
    for (const porta of [reabrir, corrigir, cancelar]) await expect(porta(f.comandaId)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
    expect(await statusOf(f.comandaId)).toBe("fechada");
    expect((await db.select().from(clientPackages).where(eq(clientPackages.id, f.cp.id)))[0].usedSessions).toBe(2); // nada foi desfeito
  });

  it("pendente já enviada (chave ligada) segura a comanda; pendente nunca enviada é descartada e libera", async () => {
    await setSetting("nfse_modo", "teste");
    const f = await fechadaComTudo();
    const enviada = await nota(f.comandaId, "pendente", 1);
    for (const porta of [reabrir, corrigir, cancelar]) await expect(porta(f.comandaId)).rejects.toThrow("A nota fiscal desta comanda ainda está sendo enviada: espere a resposta do governo antes.");
    await db.update(fiscalDocuments).set({ status: "rejeitada" }).where(eq(fiscalDocuments.id, enviada.id));
    const nunca = await nota(f.comandaId, "pendente", 0);
    await reabrir(f.comandaId);
    expect(await statusOf(f.comandaId)).toBe("aberta");
    expect(await docOf(nunca.id)).toMatchObject({ status: "rejeitada", rejectReason: "Descartada: a comanda foi reaberta antes do envio." });
    // M-4: o descarte fica na auditoria, com de/para e quem reabriu.
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "nota_descartada"));
    expect(a).toMatchObject({ userId: s.gestora.id, entityId: f.comandaId });
    expect(a.data).toEqual({ tipo: "nfse", nota: nunca.number, de: "pendente", para: "rejeitada", motivo: "Descartada: a comanda foi reaberta antes do envio." });
  });

  it("erro_envio e a DPS existe no governo: a nota vira autorizada com a chave e a comanda não reabre (nas três portas)", async () => {
    for (const porta of [reabrir, corrigir, cancelar]) {
      const f = await fechadaComTudo();
      const n = await nota(f.comandaId, "erro_envio", 10);
      const g = sefin(EXISTE);
      await expect(porta(f.comandaId, g.deps)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
      expect(g.calls).toEqual([`GET https://sefin.producaorestrita.nfse.gov.br/SefinNacional/dps/${n.localId}`]);
      expect(await docOf(n.id)).toMatchObject({ status: "autorizada", accessKey: CHAVE });
      expect(await statusOf(f.comandaId)).toBe("fechada");
      await resetDb(); s = await setupCaixa(); await setSetting("nfse_modo", "teste");
    }
  });

  it("erro_envio e a DPS não existe: a nota fica rejeitada (não saiu) e a comanda reabre", async () => {
    const f = await fechadaComTudo();
    const n = await nota(f.comandaId, "erro_envio", 10);
    await reabrir(f.comandaId, sefin(NAO_EXISTE).deps);
    expect(await statusOf(f.comandaId)).toBe("aberta");
    expect(await docOf(n.id)).toMatchObject({ status: "rejeitada", rejectReason: "Não saiu no governo (conferido antes de reabrir a comanda)." });
    // M-4: a conferência antes de reabrir fica na auditoria, com de/para e quem pediu.
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "nota_conferida"));
    expect(a).toMatchObject({ userId: s.gestora.id, entityId: f.comandaId });
    expect(a.data).toEqual({ tipo: "nfse", nota: n.number, de: "erro_envio", para: "rejeitada", motivo: "Não saiu no governo (conferido antes de reabrir a comanda)." });
  });

  it("I-3: nota de Teste só segura a comanda com a chave em Teste; em Produção ou Desligada, não (nem é conferida no governo)", async () => {
    const f = await fechadaComTudo();
    await nota(f.comandaId, "autorizada");
    await expect(reabrir(f.comandaId)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
    await setSetting("nfse_modo", "producao");
    await reabrir(f.comandaId);
    expect(await statusOf(f.comandaId)).toBe("aberta");
  });

  it("I-3: com a chave Desligada, a nota de Teste incerta não é conferida no governo e não segura a comanda", async () => {
    await setSetting("nfse_modo", "desligada");
    const g = await fechadaComTudo();
    const n = await nota(g.comandaId, "erro_envio", 10);
    const consulta = sefin(EXISTE);
    await cancelar(g.comandaId, consulta.deps);
    expect(consulta.calls).toEqual([]);
    expect(await statusOf(g.comandaId)).toBe("cancelada");
    expect((await docOf(n.id)).status).toBe("erro_envio");
  });

  it("I-3: nota de Produção segura a comanda em qualquer chave", async () => {
    await setSetting("nfse_modo", "desligada");
    const f = await fechadaComTudo();
    await nota(f.comandaId, "autorizada", 0, "producao");
    for (const porta of [reabrir, corrigir, cancelar]) await expect(porta(f.comandaId)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
  });

  const CERT_PARA_REABRIR = "Para reabrir, o CRM precisa conferir a nota no governo com o certificado digital A1 válido no servidor. Renove/instale o certificado ou use \"Resolver fora do CRM\" (Gestão).";
  it("I-2: erro_envio sem certificado no servidor ou com o A1 vencido: frase própria, sem falar com o governo", async () => {
    vi.stubEnv("FISCAL_CERT_PATH", "");
    const f = await fechadaComTudo();
    const n = await nota(f.comandaId, "erro_envio", 10);
    await expect(reabrir(f.comandaId)).rejects.toThrow(CERT_PARA_REABRIR);
    const vencido = sefin(NAO_EXISTE);
    const deps: NfseDeps = { ...vencido.deps, cert: { ...cert, notAfter: new Date(NOW.getTime() - 60_000) } };
    for (const porta of [reabrir, corrigir, cancelar]) await expect(porta(f.comandaId, deps)).rejects.toThrow(CERT_PARA_REABRIR);
    expect(vencido.calls).toEqual([]);
    expect((await docOf(n.id)).status).toBe("erro_envio");
    expect(await statusOf(f.comandaId)).toBe("fechada");
    vi.unstubAllEnvs();
  });

  it("I-2: 'Resolver fora do CRM' libera a comanda presa (erro_envio que não saiu; autorizada resolvida no portal)", async () => {
    const f = await fechadaComTudo();
    const n = await nota(f.comandaId, "erro_envio", 10);
    await resolverNotaForaDoCrm(n.id, { escolha: "nao_saiu", motivo: "Conferi no portal: não saiu" }, s.caixaGestao, NOW);
    const g = sefin(EXISTE);
    await reabrir(f.comandaId, g.deps);
    expect(g.calls).toEqual([]); // já resolvida: não consulta
    expect(await statusOf(f.comandaId)).toBe("aberta");
  });

  it("I-2: nota autorizada resolvida fora do CRM ('saiu e foi resolvida') libera cancelar a comanda", async () => {
    const f = await fechadaComTudo();
    const n = await nota(f.comandaId, "autorizada");
    await expect(cancelar(f.comandaId)).rejects.toThrow("Essa comanda tem nota fiscal autorizada: cancele a nota antes.");
    await resolverNotaForaDoCrm(n.id, { escolha: "saiu_resolvida", motivo: "Cancelada no portal do nfse.gov.br" }, s.caixaGestao, NOW);
    await cancelar(f.comandaId);
    expect(await statusOf(f.comandaId)).toBe("cancelada");
  });

  it("erro_envio e a consulta falha: recusa com frase e nada muda", async () => {
    const f = await fechadaComTudo();
    const n = await nota(f.comandaId, "erro_envio", 10);
    await expect(reabrir(f.comandaId, sefin("timeout").deps)).rejects.toThrow("Não deu para conferir a nota no governo agora. Tente de novo em alguns minutos.");
    expect(await statusOf(f.comandaId)).toBe("fechada");
    expect((await docOf(n.id)).status).toBe("erro_envio");
  });

  it("chave DESLIGADA com pendente já enviada: confere no governo (ambiente da nota) em vez de travar a comanda", async () => {
    await setSetting("nfse_modo", "desligada");
    const f = await fechadaComTudo();
    const n = await nota(f.comandaId, "pendente", 2, "producao");
    const g = sefin(NAO_EXISTE);
    await reabrir(f.comandaId, g.deps);
    expect(g.calls).toHaveLength(1);
    expect(await statusOf(f.comandaId)).toBe("aberta");
    expect((await docOf(n.id)).status).toBe("rejeitada");
  });
});
