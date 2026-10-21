import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { auditLog, clientPackages, packageDefs } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { cliente } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { extendPackage, listPackageCards, listPackageDefs, savePackageDef, setPackageSessionValue } from "./packages";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });

it("pacote à venda: nome, serviços × sessões; repetir serviço ou zero sessão é recusado; editar e desativar", async () => {
  await expect(savePackageDef({ name: " ", priceCents: 1, validityDays: 30, items: [{ serviceId: s.corte.id, sessions: 1, unitCents: null }] }, s.caixaGestao)).rejects.toThrow("Dê um nome ao pacote.");
  await expect(savePackageDef({ name: "Combo", priceCents: 1, validityDays: 30, items: [] }, s.caixaGestao)).rejects.toThrow("Escolha ao menos um serviço.");
  await expect(savePackageDef({ name: "Combo", priceCents: 1, validityDays: 30, items: [{ serviceId: s.corte.id, sessions: 0, unitCents: null }] }, s.caixaGestao)).rejects.toThrow("Sessões de 1 a 100.");
  await expect(savePackageDef({ name: "Combo", priceCents: 1, validityDays: 30, items: [{ serviceId: s.corte.id, sessions: 1, unitCents: null }, { serviceId: s.corte.id, sessions: 2, unitCents: null }] }, s.caixaGestao)).rejects.toThrow("Corte aparece duas vezes.");
  const { id } = await savePackageDef({ name: "Combo Método Fiaes", priceCents: 40000, validityDays: 90, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: 10000 }] }, s.caixaGestao);
  await savePackageDef({ id, name: "Combo Método Fiaes", priceCents: 42000, validityDays: 120, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: 10500 }], active: false }, s.caixaGestao);
  expect((await db.select().from(packageDefs).where(eq(packageDefs.id, id)))[0]).toMatchObject({ priceCents: 42000, validityDays: 120, active: false });
  expect(await listPackageDefs({ activeOnly: true })).toHaveLength(0);
  expect((await listPackageDefs())[0].serviceLabels).toEqual(["Corte"]);
});

it("novo prazo (gestão, com auditoria) e valor por sessão dos pacotes do Avec", async () => {
  const p = await cliente("Paula Souza");
  const [cp] = await db.insert(clientPackages).values({ contactId: p.contactId, clientName: "Paula Souza", packageName: "Combo", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, validUntil: "2026-10-03", externalKey: "avec:1" }).returning();
  await expect(extendPackage(cp.id, { validUntil: "2026-10-01" }, s.caixaGestao)).rejects.toThrow("O novo prazo tem de ser depois do atual (03/10).");
  await extendPackage(cp.id, { validUntil: "2026-12-31" }, s.caixaGestao);
  await setPackageSessionValue(cp.id, 9000, s.caixaGestao);
  expect((await db.select().from(clientPackages).where(eq(clientPackages.id, cp.id)))[0]).toMatchObject({ validUntil: "2026-12-31", unitCents: 9000 });
  expect((await db.select().from(auditLog).where(eq(auditLog.action, "pacote_novo_prazo")))[0].data).toMatchObject({ de: "2026-10-03", para: "2026-12-31" });
});

it("aba Serviços › Pacotes: descrição para a IA; cartão com sessões e quantas clientes têm o pacote ativo agora (vencido, esgotado e cancelado não contam)", async () => {
  const { id } = await savePackageDef({ name: "Combo 4 Cortes", priceCents: 28_000, validityDays: 90, description: "  Um corte por mês. ", items: [{ serviceId: s.corte.id, sessions: 4, unitCents: null }] }, s.caixaGestao);
  expect((await db.select().from(packageDefs).where(eq(packageDefs.id, id)))[0].description).toBe("Um corte por mês.");
  // Editar sem mandar a descrição (o editor do Caixa) não apaga.
  await savePackageDef({ id, name: "Combo 4 Cortes", priceCents: 30_000, validityDays: 90, items: [{ serviceId: s.corte.id, sessions: 4, unitCents: null }] }, s.caixaGestao);
  expect((await db.select().from(packageDefs).where(eq(packageDefs.id, id)))[0]).toMatchObject({ description: "Um corte por mês.", priceCents: 30_000 });
  await expect(savePackageDef({ id, name: "Combo 4 Cortes", priceCents: 1, validityDays: 90, description: "x".repeat(601), items: [{ serviceId: s.corte.id, sessions: 4, unitCents: null }] }, s.caixaGestao)).rejects.toThrow("Descrição");

  const a = await cliente("Ana"), b = await cliente("Bia");
  const base = { packageName: "Combo 4 Cortes", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, packageDefId: id, validUntil: "2026-12-31" };
  await db.insert(clientPackages).values([
    { ...base, contactId: a.contactId, externalKey: "a1" }, { ...base, contactId: a.contactId, serviceLabel: "Escova", externalKey: "a2" }, // 2 serviços, 1 cliente
    { ...base, contactId: b.contactId, externalKey: "b1" },
    { ...base, clientName: "Vencida", validUntil: "2026-10-01", externalKey: "v" },
    { ...base, clientName: "Esgotada", usedSessions: 4, externalKey: "e" },
    { ...base, clientName: "Cancelada", cancelledAt: new Date(), externalKey: "c" },
    // Uma compra em 2 linhas com um serviço esgotado: a compra está esgotada (não conta como ativa).
    { ...base, clientName: "Combo Esgotado", purchasedOn: "2026-06-01", usedSessions: 4, externalKey: "ce1" },
    { ...base, clientName: "Combo Esgotado", purchasedOn: "2026-06-01", serviceLabel: "Escova", usedSessions: 2, externalKey: "ce2" },
  ]);
  const cards = await listPackageCards(new Date("2026-10-16T15:00:00Z"));
  expect(cards).toEqual([expect.objectContaining({ id, name: "Combo 4 Cortes", sessions: 4, serviceLabels: ["Corte"], activeClients: 2, active: true, description: "Um corte por mês." })]);
});
