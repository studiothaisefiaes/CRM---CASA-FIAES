import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, appointments, auditLog, contacts, professionals, settings, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { listAgendaBlocks } from "../../queries/avec";
import { applyAvecFile } from "../avec/apply";
import { buildXlsx, readXlsx } from "../avec/xlsx";
import { clientsInsideText } from "@/lib/agenda-blocks";
import { CONSULTA_MSG } from "@/lib/agenda-settings";
import { createBlock, deleteBlock, updateBlock, type BlockInput } from "./blocks";

let g = "", ana = "", bia = "";
const midnight = (day: string) => new Date(`${day}T03:00:00Z`); // 00:00 em Salvador
const dayRange = (day: string, days = 1) => ({ from: midnight(day), to: new Date(midnight(day).getTime() + days * 86_400_000) });
const at = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const base = (): BlockInput => ({ professionalId: ana, startsOn: "2026-10-16", endsOn: "2026-10-16", startTime: "12:00", endTime: "13:00", weekdays: null, reason: "almoco" });
const row = async (id: string) => (await db.select().from(agendaBlocks).where(eq(agendaBlocks.id, id)))[0];
const setMode = (m: string) => db.insert(settings).values({ key: "agenda_modo", value: m }).onConflictDoUpdate({ target: settings.key, set: { value: m } });

beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [ana, bia] = (await db.insert(professionals).values([{ name: "Ana" }, { name: "Bia" }]).returning()).map((p) => p.id);
  await setMode("dupla");
});

describe("bloqueios criados no CRM", () => {
  it("cria com origem crm e chave crm:blq:<id>, aparece na agenda e fica na auditoria", async () => {
    const r = await createBlock(base(), g);
    expect(await row(r.id)).toMatchObject({ origin: "crm", externalKey: `crm:blq:${r.id}`, title: "Almoço", reason: "almoco", createdBy: g, professionalId: ana, weekdays: null });
    expect((await listAgendaBlocks(dayRange("2026-10-16"))).map((b) => [b.id, b.origin, b.reason])).toEqual([[r.id, "crm", "almoco"]]);
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "criou_bloqueio"), eq(auditLog.entityId, r.id)))).toHaveLength(1);
    expect(r.clientsInside).toEqual([]);
  });

  it("edita com de/para; apagar só marca a data e quem apagou e some da agenda", async () => {
    const { id } = await createBlock(base(), g);
    await updateBlock(id, { ...base(), endTime: "14:00", reason: "outro", note: "Reunião" }, g);
    expect(await row(id)).toMatchObject({ endTime: "14:00", title: "Reunião", reason: "outro", updatedBy: g });
    const [edit] = await db.select().from(auditLog).where(eq(auditLog.action, "editou_bloqueio"));
    expect(edit.data).toMatchObject({ de: { endTime: "13:00", title: "Almoço" }, para: { endTime: "14:00", title: "Reunião" } });
    await deleteBlock(id, g);
    expect(await row(id)).toMatchObject({ deletedBy: g });
    expect((await row(id)).deletedAt).toBeInstanceOf(Date);
    expect(await listAgendaBlocks(dayRange("2026-10-16"))).toEqual([]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "apagou_bloqueio"))).toHaveLength(1);
    await expect(updateBlock(id, base(), g)).rejects.toThrow("Esse bloqueio já foi apagado.");
  });

  it("'Todas' = sem profissional; repete só nos dias da semana escolhidos", async () => {
    const { id } = await createBlock({ ...base(), professionalId: null, startsOn: "2026-10-13", endsOn: "2026-10-31", weekdays: [6, 2, 2], reason: "curso" }, g);
    expect(await row(id)).toMatchObject({ professionalId: null, weekdays: [2, 6], title: "Curso" });
    expect((await listAgendaBlocks(dayRange("2026-10-20"))).map((b) => b.id)).toEqual([id]);
  });

  it("recusa com o motivo escrito", async () => {
    await expect(createBlock({ ...base(), reason: "x" as never }, g)).rejects.toThrow("Escolha o motivo do bloqueio.");
    await expect(createBlock({ ...base(), reason: "outro", note: "  " }, g)).rejects.toThrow("Escreva o motivo do bloqueio.");
    await expect(createBlock({ ...base(), startsOn: "2026-10-17" }, g)).rejects.toThrow("A data final não pode vir antes da inicial.");
    await expect(createBlock({ ...base(), endsOn: "2027-10-18" }, g)).rejects.toThrow("Use um período de até 366 dias.");
    await expect(createBlock({ ...base(), startTime: "13:00", endTime: "12:00" }, g)).rejects.toThrow("A hora final precisa ser depois da inicial.");
    await expect(createBlock({ ...base(), startTime: "9h" }, g)).rejects.toThrow("Confira as horas (HH:MM).");
    await expect(createBlock({ ...base(), weekdays: [0] }, g)).rejects.toThrow("Nenhum dos dias escolhidos cai nesse período."); // 16/10 é sexta
    await expect(createBlock({ ...base(), professionalId: "00000000-0000-4000-8000-000000000000" }, g)).rejects.toThrow("Profissional não encontrada.");
    expect(await db.select().from(agendaBlocks)).toEqual([]);
  });

  it("dia inteiro vai até 24:00", async () => {
    const { id } = await createBlock({ ...base(), startTime: "00:00", endTime: "24:00", reason: "folga" }, g);
    expect(await row(id)).toMatchObject({ startTime: "00:00", endTime: "24:00", title: "Folga" });
  });

  it("no modo consulta, criar, editar e apagar são recusados com a frase da tela", async () => {
    const { id } = await createBlock(base(), g);
    await setMode("consulta");
    await expect(createBlock(base(), g)).rejects.toThrow(CONSULTA_MSG);
    await expect(updateBlock(id, { ...base(), endTime: "14:00" }, g)).rejects.toThrow(CONSULTA_MSG);
    await expect(deleteBlock(id, g)).rejects.toThrow(CONSULTA_MSG);
    expect((await row(id)).deletedAt).toBeNull();
  });

  it("bloqueio por cima de clientes marcadas: salva, lista as clientes e não mexe nelas", async () => {
    const [c] = await db.insert(contacts).values({ name: "Paula Teste", phoneE164: "+5571999990001" }).returning();
    const ap = (over: Partial<typeof appointments.$inferInsert>) => ({ serviceLabel: "Corte", status: "agendado", durationMin: 60, origin: "crm", externalKey: `crm:${Math.random()}`, ...over } as typeof appointments.$inferInsert & { startsAt: Date });
    await db.insert(appointments).values([
      ap({ contactId: c.id, professionalId: ana, startsAt: at("2026-10-16", "11:30") }), // 11:30–12:30: pega o almoço
      ap({ clientName: "Rita Fora", professionalId: ana, startsAt: at("2026-10-16", "13:00") }), // começa quando o bloqueio termina
      ap({ clientName: "Lia Cancelou", professionalId: ana, startsAt: at("2026-10-16", "12:15"), status: "cancelado" }),
      ap({ clientName: "Sol Outra", professionalId: bia, startsAt: at("2026-10-16", "12:00") }), // outra profissional
    ]);
    const r = await createBlock(base(), g);
    expect(r.clientsInside).toEqual([{ name: "Paula Teste", startsAt: at("2026-10-16", "11:30").toISOString(), professionalName: "Ana" }]);
    expect(clientsInsideText(r.clientsInside)).toBe("1 cliente marcada: Paula 11:30");
    expect((await db.select().from(appointments).where(eq(appointments.contactId, c.id)))[0].status).toBe("agendado");
    const todas = await createBlock({ ...base(), professionalId: null }, g);
    expect(todas.clientsInside.map((x) => x.name)).toEqual(["Paula Teste", "Sol Outra"]);
  });
});

describe("bloqueio do Avec apagado no CRM", () => {
  const H = ["Data inicial", "Data final", "Hora inicial", "Hora final", "Profissional", "Titulo", "obs", "Serviço", "Periodo da semana"];
  const file = async (obs = "") => ({ fileName: "bloqueios.xlsx", rows: await readXlsx(await buildXlsx([H, ["16/10/2026", "16/10/2026", "09:00", "10:00", "ANA", "Folga", obs, "", ""]])) });

  it("reimportar o mesmo relatório (ou um que completa o bloqueio) não traz de volta", async () => {
    await applyAvecFile(await file());
    const [blk] = await db.select().from(agendaBlocks);
    expect(blk).toMatchObject({ origin: "avec", professionalId: ana, reason: null });
    await deleteBlock(blk.id, g);
    expect((await applyAvecFile(await file())).summary.bloqueios).toBe(0);
    await applyAvecFile(await file("trazer atestado"));
    expect(await row(blk.id)).toMatchObject({ deletedBy: g, notes: null });
    expect(await db.select().from(agendaBlocks)).toHaveLength(1);
    expect(await listAgendaBlocks(dayRange("2026-10-16"))).toEqual([]);
  });
});
