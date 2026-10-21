import { randomUUID } from "node:crypto";
import { beforeEach, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { bahia, cliente, NOW } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { agendaRange } from "@/lib/agenda";
import { createVisit } from "../domain/agenda/visits";
import { addPayment, closeComanda, openComandaForAppointment } from "../domain/caixa/comandas";
import { getAgenda } from "./agenda";

beforeEach(async () => { await resetDb(); });

it("selo R$: horário com comanda fechada vem `paid`; com comanda aberta, `openComandaId` (falta fechar)", async () => {
  const s = await setupCaixa();
  const p = await cliente("Paula Souza");
  const v = await createVisit({ requestKey: randomUUID(), client: { contactId: p.contactId }, startsAt: bahia(15, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId: s.ana.id, preference: "escolhida" }, { serviceId: s.hidratacao.id, professionalId: s.bia.id, preference: "escolhida", mode: "depois" }] }, s.recepcao, bahia(15, 8));
  const c = await openComandaForAppointment(v.appointmentIds[0], s.caixaRecepcao, NOW);
  const range = agendaRange({ d: "2026-10-15" }, NOW);
  expect((await getAgenda(range, NOW)).filter((i) => i.source === "agendamento").map((i) => [i.openComandaId, i.paid])).toEqual([[c.comandaId, false], [c.comandaId, false]]);
  await addPayment(c.comandaId, { method: "pix", valueCents: 21000 }, s.caixaRecepcao, NOW);
  await closeComanda(c.comandaId, {}, s.caixaRecepcao, NOW);
  expect((await getAgenda(range, NOW)).filter((i) => i.source === "agendamento").map((i) => [i.openComandaId, i.paid])).toEqual([[null, true], [null, true]]);
});
