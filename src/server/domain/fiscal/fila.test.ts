import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, fiscalDocuments, type FiscalDocument } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { authorizedDoc, failedDoc, processPendingKind, type Canal } from "./fila";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const T0 = new Date("2026-10-15T18:00:00Z");
const nota = async (status = "pendente", attempts = 0) => {
  const c = await comanda({ day: "2026-10-15", by: s.cati.id, items: [{ label: "Corte", unitCents: 12000, netCents: 12000 }] });
  return (await db.insert(fiscalDocuments).values({ comandaId: c.id, kind: "nfse", environment: "teste", series: 1, number: Math.floor(Math.random() * 1e9) + 1,
    localId: `DPS${Math.random()}`, status, attempts, amountCents: 12000, createdAt: new Date(T0.getTime() - 60_000 + Math.floor(Math.random() * 1000)) }).returning())[0];
};
const docOf = async (id: string) => (await db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, id)))[0];

it("o worker lê o relógio a cada nota: a reserva de cada uma usa a hora dela (não a do começo do lote)", async () => {
  for (let i = 0; i < 3; i++) await nota();
  let t = T0.getTime();
  const clock = () => { const d = new Date(t); t += 10 * 60_000; return d; }; // cada leitura anda 10 min (envios lentos)
  const reservas: { at: number; ate: number }[] = [];
  const canal: Canal = {
    now: () => new Date(t),
    consultar: async () => ({ kind: "nao_existe" }),
    // A linha que chega aqui é a da reserva: o next_try_at é a hora da nota + 5 min.
    enviar: async (doc: FiscalDocument) => { reservas.push({ at: t, ate: doc.nextTryAt!.getTime() }); return { kind: "autorizada", accessKey: "1".repeat(50), responseBody: "<ok/>" }; },
  };
  expect(await processPendingKind("nfse", clock, async () => canal, 10)).toEqual({ autorizadas: 3, rejeitadas: 0, falhas: 0 });
  // Leituras: T0 (seleção), T0+10 (nota 1), T0+20 (nota 2), T0+30 (nota 3).
  expect(reservas.map((r) => (r.ate - T0.getTime()) / 60_000)).toEqual([15, 25, 35]);
});

it("resultado atrasado não sobrescreve nota já resolvida (falha nem autorização)", async () => {
  const n = await nota("pendente", 1);
  const lida = { ...n }; // o que um envio lento leu
  await db.update(fiscalDocuments).set({ status: "autorizada", accessKey: "2".repeat(50) }).where(eq(fiscalDocuments.id, n.id));
  await failedDoc(lida, "tempo esgotado", T0);
  expect(await docOf(n.id)).toMatchObject({ status: "autorizada", accessKey: "2".repeat(50), lastError: null, nextTryAt: null });
  await db.update(fiscalDocuments).set({ status: "rejeitada" }).where(eq(fiscalDocuments.id, n.id));
  await authorizedDoc(lida, "3".repeat(50), "<x/>", T0);
  expect(await docOf(n.id)).toMatchObject({ status: "rejeitada", accessKey: "2".repeat(50) });
});

it("autorização que chega depois de a nota ser resolvida por outro caminho não sobrescreve e fica na auditoria (M-4), sem XML nem CPF", async () => {
  const n = await nota("pendente", 1);
  const lida = { ...n };
  await db.update(fiscalDocuments).set({ status: "rejeitada", rejectReason: "Resolvida fora do CRM: conferi no portal" }).where(eq(fiscalDocuments.id, n.id));
  await authorizedDoc(lida, "4".repeat(50), "<NFSe><CPF>52998224725</CPF></NFSe>", T0);
  expect(await docOf(n.id)).toMatchObject({ status: "rejeitada", accessKey: null });
  const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "nota_autorizada_tardia"));
  expect(a).toMatchObject({ entity: "comanda", entityId: n.comandaId, userId: null });
  expect(a.data).toEqual({ tipo: "nfse", nota: n.number, id: n.id, chave: "4".repeat(50), situacao: "rejeitada" });
  expect(JSON.stringify(a.data)).not.toContain("52998224725");
});

it("a mesma autorização vista duas vezes (outro caminho já gravou a mesma chave) não vira aviso de tardia", async () => {
  const n = await nota("pendente", 1);
  const lida = { ...n };
  await db.update(fiscalDocuments).set({ status: "autorizada", accessKey: "5".repeat(50) }).where(eq(fiscalDocuments.id, n.id));
  await authorizedDoc(lida, "5".repeat(50), "<x/>", T0);
  expect(await db.select().from(auditLog).where(eq(auditLog.action, "nota_autorizada_tardia"))).toHaveLength(0);
});
