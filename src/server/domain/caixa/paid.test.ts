import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { db } from "../../db";
import { clientPackages, salesPayments } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { createVisit } from "../agenda/visits";
import { addCreditTx } from "./credits";
import { addPayment, closeComanda, openComandaForAppointment } from "./comandas";
import { countPaidNotUsed, listPaidNotUsed } from "./paid";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa(); });
const pacote = (contactId: string, o: Partial<typeof clientPackages.$inferInsert> = {}) =>
  db.insert(clientPackages).values({ contactId, clientName: "x", packageName: "Combo Método Fiaes", serviceLabel: "Corte", totalSessions: 4, usedSessions: 1, priceCents: 40000, purchasedOn: "2026-09-01", validUntil: "2027-03-12", externalKey: `t:${randomUUID()}`, ...o });

it("cada origem entra uma vez por cliente; pacote esgotado ou vencido sai; serviço pago com horário que já passou sai", async () => {
  const paula = await cliente("Paula Souza");
  await pacote(paula.contactId);
  await pacote(paula.contactId, { usedSessions: 4 }); // esgotado
  await pacote(paula.contactId, { validUntil: "2026-10-01" }); // vencido (a gestão dá novo prazo)
  await db.transaction((tx) => addCreditTx(tx, { contactId: paula.contactId, deltaCents: 3000, reason: "troco" }, s.cati.id));
  const rita = await cliente("Rita Lima");
  // Rita pagou antes do horário de amanhã (comanda fechada ligada a um horário futuro)
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId: rita.contactId }, startsAt: bahia(16, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }] }, s.recepcao, NOW);
  const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
  await addPayment(c.comandaId, { method: "pix", valueCents: 12000 }, s.caixaRecepcao, NOW);
  // fechar hoje não finaliza o horário de amanhã (6C.5): ele fica como "pago antes do horário"
  await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW);
  const lia = await cliente("Lia Souza");
  await db.insert(salesPayments).values({ contactId: lia.contactId, clientName: "Lia Souza", method: "Crédito Cliente", valueCents: 5000, paidOn: "2026-09-20", externalKey: "avec:pag:1" });

  const rows = await listPaidNotUsed({ withValues: true }, NOW);
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  expect(byName["Paula Souza"].entries.map((e) => [e.kind, e.label, e.valueCents])).toEqual([
    ["pacote", "Combo Método Fiaes · faltam 3 de 4 · vence 12/03", 40000],
    ["credito", "Crédito da cliente", 3000],
  ]);
  expect(byName["Paula Souza"].nextAppointmentAt).toBeNull();
  expect(byName["Rita Lima"].entries).toEqual([expect.objectContaining({ kind: "servico_pago", label: "Corte pago antes do horário (16/10 10:00)", valueCents: 12000, paidOn: "2026-10-15" })]);
  expect(byName["Rita Lima"].nextAppointmentAt).toBe(bahia(16, 10).toISOString());
  expect(byName["Lia Souza"].entries).toEqual([expect.objectContaining({ kind: "credito_avec", label: "Crédito no Avec (conferir)", valueCents: null })]);
  expect(await countPaidNotUsed(NOW)).toBe(3);
});

it("filtros: sem horário marcado, vence em 30 dias, pacote, crédito; sem 'valores.ver' não mostra valor", async () => {
  const paula = await cliente("Paula Souza");
  await pacote(paula.contactId, { validUntil: "2026-11-01" });
  const rita = await cliente("Rita Lima");
  await pacote(rita.contactId);
  await ap({ startsAt: bahia(20, 10), contactId: rita.contactId, professionalId: s.ana.id });
  const bia = await cliente("Bia Teles");
  await db.transaction((tx) => addCreditTx(tx, { contactId: bia.contactId, deltaCents: 1000, reason: "ajuste" }, s.cati.id));
  const nomes = async (f: Parameters<typeof listPaidNotUsed>[0]) => (await listPaidNotUsed(f, NOW)).map((r) => r.name);
  expect(await nomes({})).toEqual(["Paula Souza", "Rita Lima", "Bia Teles"]); // vence primeiro, depois sem vencimento
  expect(await nomes({ semHorario: true })).toEqual(["Paula Souza", "Bia Teles"]);
  expect(await nomes({ venceEm30: true })).toEqual(["Paula Souza"]);
  expect(await nomes({ tipo: "credito" })).toEqual(["Bia Teles"]);
  expect(await nomes({ tipo: "pacote" })).toEqual(["Paula Souza", "Rita Lima"]);
  expect((await listPaidNotUsed({}, NOW))[0].entries[0].valueCents).toBeNull();
});
