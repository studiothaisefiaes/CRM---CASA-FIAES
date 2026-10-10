import { it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { dealEvents, deals, tasks, users } from "../db/schema";
import { recordInbound } from "./deals";
import { BULK_MAX, bulkArchive, bulkAssign, bulkMove, bulkRestore } from "./bulk";
import { markAttendance } from "./updates";
import { setNextAction, nextActionOf } from "./tasks";
import { UserFacingError } from "./errors";
import { resetDb } from "../../../test/db";

let gestor = { id: "", role: "gestor" as const }, ana = { id: "", role: "atendente" as const }, bia = { id: "", role: "atendente" as const };
const leads: string[] = [];
const lead = async (n: number, ownerId: string | null) => {
  const r = await recordInbound({ channelId: null, externalId: `B${n}`, phoneRaw: `7199900000${n}`, body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return r.dealId;
};
const archivedAt = async (id: string) => (await db.select({ a: deals.archivedAt }).from(deals).where(eq(deals.id, id)))[0].a;

beforeEach(async () => {
  await resetDb();
  const mk = async (name: string, role: "gestor" | "atendente") => (await db.insert(users).values({ name, email: `${name}@c.com`, role, passwordHash: "x" }).returning())[0].id;
  gestor = { id: await mk("Gestora", "gestor"), role: "gestor" }; ana = { id: await mk("Ana", "atendente"), role: "atendente" }; bia = { id: await mk("Bia", "atendente"), role: "atendente" };
  leads.length = 0;
  leads.push(await lead(1, ana.id), await lead(2, ana.id), await lead(3, null), await lead(4, bia.id));
});

it("arquivar em massa: a atendente só age nos próprios leads e nos sem dono", async () => {
  const r = await bulkArchive(leads, ana);
  expect(r.archived).toBe(3);
  expect(r.skipped).toBe(1);
  expect(await archivedAt(leads[3])).toBeNull(); // da Bia
  for (const id of leads.slice(0, 3)) expect(await archivedAt(id)).not.toBeNull();
  expect(r.ids.sort()).toEqual(leads.slice(0, 3).sort());
});

it("a gestão arquiva de qualquer dono, e desfazer devolve só o que saiu", async () => {
  const r = await bulkArchive(leads, gestor);
  expect(r.archived).toBe(4);
  const back = await bulkRestore(r.ids, gestor);
  expect(back.restored).toBe(4);
  for (const id of leads) expect(await archivedAt(id)).toBeNull();
});

it("desfazer da atendente não restaura lead de outra pessoa", async () => {
  const r = await bulkArchive(leads, gestor);
  const back = await bulkRestore(r.ids, ana);
  expect(back.restored).toBe(3);
  expect(await archivedAt(leads[3])).not.toBeNull();
});

it("passou do limite de 100 por vez, recusa", async () => {
  const ids = Array.from({ length: BULK_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  await expect(bulkArchive(ids, gestor)).rejects.toBeInstanceOf(UserFacingError);
  await expect(bulkRestore(ids, gestor)).rejects.toBeInstanceOf(UserFacingError);
});

it("atribuir em massa: só a gestão, com auditoria de/para por lead", async () => {
  await expect(bulkAssign(leads, bia.id, ana)).rejects.toThrow("Só a gestão");
  const r = await bulkAssign(leads, bia.id, gestor);
  expect(r).toEqual({ assigned: 3, skipped: 1 }); // o da Bia já era dela
  const [d] = await db.select({ o: deals.ownerId }).from(deals).where(eq(deals.id, leads[0]));
  expect(d.o).toBe(bia.id);
  const [ev] = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, leads[0]), eq(dealEvents.type, "responsavel_alterado")));
  expect(ev.payload).toMatchObject({ campos: [{ campo: "ownerId", de: ana.id, para: bia.id }] });
});

it("mover etapa em massa: só etapas sem diálogo, e só os leads permitidos", async () => {
  await expect(bulkMove(leads, "agendado", gestor)).rejects.toThrow("pede dados");
  await expect(bulkMove(leads, "fechado", gestor)).rejects.toBeInstanceOf(UserFacingError);
  const r = await bulkMove(leads, "followup_1", ana);
  expect(r.moved).toBe(3);
  const stage = async (id: string) => (await db.query.deals.findFirst({ where: (d, { eq }) => eq(d.id, id), with: undefined }))!.stageId;
  expect(await stage(leads[0])).toBe(await stage(leads[1]));
  expect(await stage(leads[3])).not.toBe(await stage(leads[0]));
  // repetir não move de novo
  expect((await bulkMove(leads, "followup_1", ana)).moved).toBe(0);
});

const schedule = async (id: string, ownerId = ana.id) => {
  await db.update(deals).set({ ownerId }).where(eq(deals.id, id));
  const { scheduleDeal } = await import("./updates");
  await scheduleDeal(id, new Date(Date.now() + 3_600_000), ownerId);
};

it("Faltou: grava o comparecimento, conclui a conferência e cria a próxima ação Remarcar para o dono", async () => {
  await schedule(leads[0]);
  const r = await markAttendance(leads[0], "faltou", ana.id);
  expect(r.changed).toBe(true);
  const [d] = await db.select({ a: deals.attendance }).from(deals).where(eq(deals.id, leads[0]));
  expect(d.a).toBe("faltou");
  expect(await db.select().from(tasks).where(and(eq(tasks.dealId, leads[0]), eq(tasks.kind, "comparecimento"), isNull(tasks.doneAt)))).toHaveLength(0);
  const na = await nextActionOf(leads[0]);
  expect(na).toMatchObject({ assigneeId: ana.id });
  expect(na!.title).toMatch(/^Remarcar com /);
  expect(na!.dueAt.getTime()).toBeGreaterThan(Date.now());
  // repetir não duplica
  expect((await markAttendance(leads[0], "faltou", ana.id)).changed).toBe(false);
  expect((await db.select().from(tasks).where(and(eq(tasks.dealId, leads[0]), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))))).toHaveLength(1);
});

it("Compareceu conclui a conferência e não cria próxima ação; fora de Agendado recusa", async () => {
  await expect(markAttendance(leads[2], "compareceu", ana.id)).rejects.toBeInstanceOf(UserFacingError);
  await schedule(leads[0]);
  await markAttendance(leads[0], "compareceu", ana.id);
  expect(await nextActionOf(leads[0])).toBeNull();
  expect(await db.select().from(tasks).where(and(eq(tasks.dealId, leads[0]), eq(tasks.kind, "comparecimento"), isNull(tasks.doneAt)))).toHaveLength(0);
});

it("próxima ação: uma por lead (a nova cancela a antiga), responsável padrão é o dono, data passada recusa", async () => {
  const dueAt = new Date(Date.now() + 86_400_000);
  const a = await setNextAction(leads[0], { title: "Mandar valores", dueAt }, ana.id);
  expect(a.assigneeId).toBe(ana.id); // o dono do lead
  const b = await setNextAction(leads[0], { title: "Ligar", dueAt, assigneeId: bia.id }, ana.id);
  expect(b.assigneeId).toBe(bia.id);
  expect((await db.select().from(tasks).where(and(eq(tasks.dealId, leads[0]), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))))).toHaveLength(1);
  expect((await db.select().from(tasks).where(and(eq(tasks.dealId, leads[0]), eq(tasks.kind, "proxima_acao"))))).toHaveLength(2); // a antiga ficou como cancelada
  await expect(setNextAction(leads[0], { title: "x", dueAt: new Date(Date.now() - 3_600_000) }, ana.id)).rejects.toThrow("já passou");
  await expect(setNextAction(leads[0], { title: "   ", dueAt }, ana.id)).rejects.toThrow("Escreva");
  await expect(setNextAction(leads[0], { title: "x", dueAt, assigneeId: "00000000-0000-4000-8000-000000000000" }, ana.id)).rejects.toThrow("não está mais na equipe");
});
