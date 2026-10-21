import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import { appointments, professionals } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, CASA_TER_SAB, cliente, NOW, setSetting, setupAgenda } from "../../../../test/agenda-fixtures";
import { conflictText } from "@/lib/agenda-text";
import { checkSlotTx, nearest, previewBooking } from "./slots";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const base = () => ({ professionalId: s.ana.id, durationMin: 60, bufferMin: null, clientId: null, now: NOW });

describe("conferir um horário (adaptador do motor do 6A)", () => {
  it("livre: sem conflito e dentro do horário de trabalho", async () => {
    expect(await checkSlotTx(db, { ...base(), startsAt: bahia(16, 10) })).toMatchObject({ ok: true, kind: "livre", fitIn: false, outsideHours: false, conflicts: [] });
  });

  it("conflito com a mesma profissional: nome, serviço, quem marcou e a frase pronta", async () => {
    const p = await cliente("Paula Souza");
    await ap({ startsAt: bahia(16, 10), contactId: p.contactId, clientName: "Paula Souza", professionalId: s.ana.id, origin: "crm", createdBy: s.cati.id });
    const r = await checkSlotTx(db, { ...base(), startsAt: bahia(16, 10, 30) });
    expect(r).toMatchObject({ ok: true, fitIn: true });
    if (!r.ok) throw new Error();
    expect(r.conflicts[0]).toMatchObject({ clientName: "Paula Souza", serviceLabel: "Corte", sameClient: false, createdByName: "Cati" });
    expect(conflictText("Ana", r.conflicts[0])).toBe("Ana já tem Paula das 10:00 às 11:00");
  });

  it("a mesma cliente com outra profissional no mesmo horário também conflita", async () => {
    const p = await cliente("Paula Souza");
    await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.bia.id, origin: "crm" });
    const r = await checkSlotTx(db, { ...base(), startsAt: bahia(16, 10), clientId: p.contactId });
    if (!r.ok) throw new Error(r.reason);
    expect(r.conflicts[0]).toMatchObject({ sameClient: true, professionalName: "Bia" });
    expect(conflictText("Ana", r.conflicts[0])).toBe("Paula já tem Corte às 10:00 com a Bia");
  });

  it("gêmeo do Avec (avec_twin_of) não ocupa horário", async () => {
    const p = await cliente("Paula Souza");
    const crm = await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.bia.id, origin: "crm" });
    await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.ana.id, origin: "avec", avecTwinOf: crm.id });
    expect(await checkSlotTx(db, { ...base(), startsAt: bahia(16, 10) })).toMatchObject({ ok: true, fitIn: false });
  });

  it("Review Focus 3: cancelamento do Avec 'sem hora' (00:00), cancelado e lista de espera não ocupam", async () => {
    await ap({ startsAt: bahia(16, 0), professionalId: s.ana.id, status: "cancelado" });
    await ap({ startsAt: bahia(16, 0), professionalId: s.ana.id, status: "espera" });
    await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, status: "cancelado" });
    expect(await checkSlotTx(db, { ...base(), startsAt: bahia(16, 9) })).toMatchObject({ ok: true, fitIn: false });
  });

  it("dia que já passou e mais de 15 min atrás: 'passou'; até 15 min atrás vale", async () => {
    expect(await checkSlotTx(db, { ...base(), startsAt: bahia(14, 10) })).toMatchObject({ ok: false, reason: "passou" });
    const now = bahia(16, 10, 20);
    expect(await checkSlotTx(db, { ...base(), startsAt: bahia(16, 10), now })).toMatchObject({ ok: false, reason: "passou" });
    expect(await checkSlotTx(db, { ...base(), startsAt: bahia(16, 10, 10), now })).toMatchObject({ ok: true });
  });

  it("sem horário próprio, segue o da Casa: na segunda (Casa fechada) fica fora do horário, sem erro", async () => {
    await setSetting("business_hours", CASA_TER_SAB);
    const [carla] = await db.insert(professionals).values({ name: "Carla" }).returning();
    expect(await checkSlotTx(db, { ...base(), professionalId: carla.id, startsAt: bahia(19, 10) })).toMatchObject({ ok: true, outsideHours: true });
  });
});

describe("sugestões e prévia", () => {
  it("os mais perto da hora escolhida, em ordem", () => {
    expect(nearest([540, 570, 600, 660, 690], 600, 3)).toEqual([600, 660, 690]);
    expect(nearest([540, 570, 600], 660, 3)).toEqual([540, 570, 600]);
    expect(nearest([540, 570, 600, 630], null, 2)).toEqual([540, 570]);
  });

  it("prévia: 'Livre', o conflito escrito, 'Qualquer uma' pela regra do 6A e serviço sem duração pedindo a desta vez; nunca grava", async () => {
    const p = await cliente("Paula Souza");
    await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.ana.id, origin: "crm" });
    const livre = await previewBooking({ serviceId: s.corte.id, professionalId: s.ana.id, day: "2026-10-16", time: "11:00" }, NOW);
    expect(livre.preview).toMatchObject({ state: "livre", text: "Livre" });
    expect(livre.suggestions[0].startsAt.length).toBe(3);
    const ocupado = await previewBooking({ serviceId: s.corte.id, professionalId: s.ana.id, day: "2026-10-16", time: "10:30" }, NOW);
    expect(ocupado.preview).toMatchObject({ state: "encaixe", text: "Ana já tem Paula das 10:00 às 11:00" });
    const qualquer = await previewBooking({ serviceId: s.corte.id, professionalId: null, day: "2026-10-16", time: "10:00" }, NOW);
    expect(qualquer.preview).toMatchObject({ state: "livre", text: "Livre com a Bia", professionalId: s.bia.id });
    const semDuracao = await previewBooking({ serviceId: s.mechas.id, professionalId: s.ana.id, day: "2026-10-16", time: "10:00" }, NOW);
    expect(semDuracao).toMatchObject({ needsDuration: true, durationMin: null, preview: null });
    expect(await db.select().from(appointments)).toHaveLength(1);
  });
});
