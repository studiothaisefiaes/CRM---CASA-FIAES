import { beforeEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { bahia, cliente, NOW, setAgendaMode, setupAgenda } from "../../../../test/agenda-fixtures";
import { createVisit } from "./visits";
import { addToWaitlist, resolveWaitlist, waitlistMatchesFor, waitlistToReschedule } from "./waitlist";
import { ap } from "../../../../test/agenda-fixtures";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const get = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0];
const pedido = (contactId: string, over: Record<string, unknown> = {}) =>
  ({ client: { contactId }, serviceId: s.corte.id, professionalId: null, day: "2026-10-16", window: "manha" as const, ...over });
const encaixe = (professionalId: string) => ({ requestKey: randomUUID(), startsAt: bahia(16, 10).toISOString(), items: [{ serviceId: s.corte.id, professionalId }] });

it("pôr na lista: no dia pedido às 00:00 de Salvador, com a janela, quem pôs e a chave do CRM", async () => {
  const p = await cliente();
  const { id } = await addToWaitlist(pedido(p.contactId, { day: "2026-10-17", window: "tarde", notes: "prefere depois das 15h" }), s.recepcao, NOW);
  const w = await get(id);
  expect(w).toMatchObject({ status: "espera", waitWindow: "tarde", externalKey: `crm:esp:${id}`, origin: "crm", createdBy: s.cati.id, serviceLabel: "Corte", notes: "prefere depois das 15h" });
  expect(w.startsAt.toISOString()).toBe("2026-10-17T03:00:00.000Z");
  await expect(addToWaitlist(pedido(p.contactId, { day: "2026-10-14" }), s.recepcao, NOW)).rejects.toThrow("Escolha hoje ou um dia que ainda não passou.");
});

it("Encaixar: cria o horário e o pedido vira espera_encaixada, apontando o horário novo", async () => {
  const p = await cliente();
  const { id } = await addToWaitlist(pedido(p.contactId), s.recepcao, NOW);
  const r = await resolveWaitlist(id, { result: "encaixada", booking: encaixe(s.bia.id) }, s.recepcao, NOW);
  expect(r.appointmentIds).toHaveLength(1);
  expect(await get(id)).toMatchObject({ status: "espera_encaixada", waitResultAppointmentId: r.appointmentIds[0] });
  expect(await get(r.appointmentIds[0])).toMatchObject({ status: "agendado", contactId: p.contactId, professionalId: s.bia.id });
});

it("Encaixar num horário que acabou de ser ocupado cai no conflito normal, e o pedido continua na espera", async () => {
  const p = await cliente("Paula Souza"), q = await cliente("Joana Lima");
  const { id } = await addToWaitlist(pedido(q.contactId, { professionalId: s.ana.id }), s.recepcao, NOW);
  await createVisit({ ...encaixe(s.ana.id), client: { contactId: p.contactId } }, s.recepcao, NOW);
  await expect(resolveWaitlist(id, { result: "encaixada", booking: encaixe(s.ana.id) }, s.recepcao, NOW)).rejects.toThrow("acabou de ser ocupado");
  expect((await get(id)).status).toBe("espera");
});

it("Desistiu: espera_desistiu, com a nota, sem apagar; repetir é recusado", async () => {
  const p = await cliente();
  const { id } = await addToWaitlist(pedido(p.contactId), s.recepcao, NOW);
  await resolveWaitlist(id, { result: "desistiu", note: "achou outro salão" }, s.recepcao, NOW);
  expect(await get(id)).toMatchObject({ status: "espera_desistiu", cancelNote: "achou outro salão" });
  await expect(resolveWaitlist(id, { result: "desistiu" }, s.recepcao, NOW)).rejects.toThrow("Esse pedido já saiu da lista de espera.");
});

it("modo consulta recusa pôr na lista; Desistiu continua", async () => {
  const p = await cliente();
  const { id } = await addToWaitlist(pedido(p.contactId), s.recepcao, NOW);
  await setAgendaMode("consulta");
  await expect(addToWaitlist(pedido(p.contactId), s.recepcao, NOW)).rejects.toThrow("só para consulta");
  await expect(resolveWaitlist(id, { result: "desistiu" }, s.recepcao, NOW)).resolves.toEqual({ appointmentIds: [] });
});

it("quem quer o dia: só os do dia, da profissional (ou qualquer uma) e do serviço (ou sem serviço)", async () => {
  const [p, q, r0] = [await cliente("Paula Souza"), await cliente("Joana Lima"), await cliente("Rita Melo")];
  await addToWaitlist(pedido(p.contactId, { window: "dia" }), s.recepcao, NOW);
  await addToWaitlist(pedido(q.contactId, { serviceId: s.hidratacao.id, professionalId: s.bia.id, window: "tarde" }), s.recepcao, bahia(15, 9, 1));
  await addToWaitlist(pedido(r0.contactId, { day: "2026-10-17" }), s.recepcao, bahia(15, 9, 2));
  expect((await waitlistMatchesFor("2026-10-16")).map((m) => m.clientName)).toEqual(["Paula Souza", "Joana Lima"]);
  expect((await waitlistMatchesFor("2026-10-16", { professionalId: s.ana.id, serviceId: s.corte.id })).map((m) => m.clientName)).toEqual(["Paula Souza"]);
});

it("Pendências › Remarcar: o horário sem baixa é cancelado (Remarcado) e a cliente vai para a espera de hoje; recusa o que já teve baixa", async () => {
  const p = await cliente();
  const a = await ap({ contactId: p.contactId, clientName: "Paula Souza", professionalId: s.ana.id, serviceId: s.corte.id, startsAt: bahia(14, 16), preference: "escolhida" });
  const r = await waitlistToReschedule(a.id, s.recepcao, NOW);
  expect(r.day).toBe("2026-10-15");
  expect(await get(a.id)).toMatchObject({ status: "cancelado", cancelReason: "remarcado", cancelledBy: s.cati.id });
  expect(await get(r.waitlistId)).toMatchObject({ status: "espera", waitWindow: "dia", contactId: p.contactId, professionalId: s.ana.id, serviceId: s.corte.id, notes: "Remarcar o horário de 14/10 às 16:00" });
  const b = await ap({ contactId: p.contactId, clientName: "Paula Souza", professionalId: s.ana.id, startsAt: bahia(15, 8), status: "faltou" });
  await expect(waitlistToReschedule(b.id, s.recepcao, NOW)).rejects.toThrow("Só vai para a lista um horário agendado ou confirmado.");
  await setAgendaMode("consulta");
  const c = await ap({ contactId: p.contactId, clientName: "Paula Souza", startsAt: bahia(15, 8) });
  await expect(waitlistToReschedule(c.id, s.recepcao, NOW)).rejects.toThrow();
  expect((await get(c.id)).status).toBe("agendado");
});
