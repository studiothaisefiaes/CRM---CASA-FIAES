import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, fiscalDocuments } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { resolverNotaForaDoCrm } from "./resolver";

/** "Resolver fora do CRM" (revisão final, I-2): a Gestão conferiu no portal o que o CRM não consegue conferir sozinho. */
let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const T = new Date("2026-10-15T18:00:00Z");
const MOTIVO = "Conferi no portal do nfse.gov.br pela chave";
const CHAVE_NFSE = "29274082112223330001810000000000000000000000000042";
const CHAVE_NFCE = "29261011222333000181650010000000011123456786";
const nota = async (o: { kind?: "nfse" | "nfce"; status: string; attempts?: number; accessKey?: string | null }) => {
  const c = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Corte", unitCents: 12000, netCents: 12000 }] });
  return (await db.insert(fiscalDocuments).values({ comandaId: c.id, kind: o.kind ?? "nfse", environment: "producao", series: 1, number: Math.floor(Math.random() * 1e9) + 1,
    localId: `DPS${Math.random()}`, status: o.status, attempts: o.attempts ?? 0, amountCents: 12000, accessKey: o.accessKey ?? null, lastError: o.status === "erro_envio" ? "Sem resposta do governo" : null }).returning())[0];
};
const docOf = async (id: string) => (await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id)))[0];
const audits = () => db.select().from(auditLog).where(eq(auditLog.action, "nota_resolvida_fora"));

describe("Resolver fora do CRM", () => {
  it("Regra do dono: sem nota.resolver, recusa no servidor (caixa.gerir e nota.cancelar não bastam) e nada muda", async () => {
    const n = await nota({ status: "erro_envio", attempts: 10 });
    const semPerm = { id: s.gestora.id, perms: s.caixaGestao.perms.filter((p) => p !== "nota.resolver") };
    expect(semPerm.perms).toContain("nota.cancelar");
    await expect(resolverNotaForaDoCrm(n.id, { escolha: "nao_saiu", motivo: MOTIVO }, semPerm, T)).rejects.toThrow("Você não tem permissão para resolver nota fora do CRM.");
    expect((await docOf(n.id)).status).toBe("erro_envio");
    expect(await audits()).toHaveLength(0);
  });

  it("motivo com menos de 15 letras é recusado", async () => {
    const n = await nota({ status: "erro_envio", attempts: 10 });
    await expect(resolverNotaForaDoCrm(n.id, { escolha: "nao_saiu", motivo: "  conferi   " }, s.caixaGestao, T)).rejects.toThrow("Escreva o motivo (pelo menos 15 letras).");
    expect((await docOf(n.id)).status).toBe("erro_envio");
  });

  it("'Conferi no portal: a nota NÃO saiu': erro_envio vira rejeitada com o motivo e a auditoria de/para", async () => {
    const n = await nota({ status: "erro_envio", attempts: 10 });
    await resolverNotaForaDoCrm(n.id, { escolha: "nao_saiu", motivo: MOTIVO }, s.caixaGestao, T);
    expect(await docOf(n.id)).toMatchObject({ status: "rejeitada", rejectReason: `Resolvida fora do CRM: ${MOTIVO}`, nextTryAt: null, lastError: null });
    const [a] = await audits();
    expect(a).toMatchObject({ userId: s.gestora.id, entityId: n.comandaId });
    expect(a.data).toEqual({ tipo: "nfse", nota: n.number, de: "erro_envio", para: "rejeitada", motivo: MOTIVO, chave: null });
  });

  it("'A nota saiu e foi resolvida fora do CRM': pendente já enviada vira cancelada, com a chave informada", async () => {
    const n = await nota({ status: "pendente", attempts: 3 });
    await resolverNotaForaDoCrm(n.id, { escolha: "saiu_resolvida", motivo: MOTIVO, chave: CHAVE_NFSE }, s.caixaGestao, T);
    expect(await docOf(n.id)).toMatchObject({ status: "cancelada", accessKey: CHAVE_NFSE, cancelReason: `Resolvida fora do CRM: ${MOTIVO}`, cancelledAt: T, cancelledBy: s.gestora.id, nextTryAt: null });
    expect((await audits())[0].data).toMatchObject({ de: "pendente", para: "cancelada", chave: CHAVE_NFSE });
  });

  it("NFC-e autorizada (fora do prazo de cancelamento): 'saiu e foi resolvida' vira cancelada e guarda a chave que já tinha", async () => {
    const n = await nota({ kind: "nfce", status: "autorizada", accessKey: CHAVE_NFCE });
    await resolverNotaForaDoCrm(n.id, { escolha: "saiu_resolvida", motivo: "Nota de devolução emitida pelo contador" }, s.caixaGestao, T);
    expect(await docOf(n.id)).toMatchObject({ status: "cancelada", accessKey: CHAVE_NFCE });
    expect((await audits())[0].data).toMatchObject({ tipo: "nfce", de: "autorizada", para: "cancelada", chave: CHAVE_NFCE });
  });

  it("nota autorizada não pode ser marcada como 'não saiu'; chave com tamanho errado é recusada", async () => {
    const a = await nota({ status: "autorizada", accessKey: CHAVE_NFSE });
    await expect(resolverNotaForaDoCrm(a.id, { escolha: "nao_saiu", motivo: MOTIVO }, s.caixaGestao, T))
      .rejects.toThrow("Essa nota foi autorizada pelo governo: escolha \"A nota saiu e foi resolvida fora do CRM\".");
    const e = await nota({ kind: "nfce", status: "erro_envio", attempts: 10 });
    await expect(resolverNotaForaDoCrm(e.id, { escolha: "saiu_resolvida", motivo: MOTIVO, chave: CHAVE_NFSE }, s.caixaGestao, T)).rejects.toThrow("A chave de acesso da NFC-e tem 44 números.");
    expect((await docOf(a.id)).status).toBe("autorizada");
    expect((await docOf(e.id)).status).toBe("erro_envio");
  });

  it("só erro no envio, enviando (já enviada) ou autorizada: as outras situações são recusadas", async () => {
    for (const [status, attempts] of [["pendente", 0], ["rejeitada", 2], ["cancelada", 1]] as const) {
      const n = await nota({ status, attempts });
      await expect(resolverNotaForaDoCrm(n.id, { escolha: "saiu_resolvida", motivo: MOTIVO }, s.caixaGestao, T))
        .rejects.toThrow("Só nota com erro no envio, enviando ou autorizada pode ser resolvida fora do CRM.");
    }
    expect(await audits()).toHaveLength(0);
  });
});
