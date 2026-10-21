import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contacts, deals, messages, stages, tasks } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyFunnelMigration, classify, migrateStagesConfig, planFunnelMigration, summarize } from "./funnel-migration";

const NOW = new Date("2026-10-15T15:00:00Z");
const DAY = 86_400_000;
const rel = (d: number) => new Date(NOW.getTime() + d * DAY);
let n = 0;

beforeEach(async () => { n = 0; await resetDb(); });

async function conversa(stage: string, o: { last?: "in" | "out"; encerrada?: boolean; futuro?: number; veio?: number; pacote?: boolean; tarefaVencida?: boolean } = {}) {
  n++;
  const [c] = await db.insert(contacts).values({ name: `Cliente${n} Teste`, phoneE164: `+5571966${String(n).padStart(6, "0")}` }).returning();
  const [st] = await db.select().from(stages).where(eq(stages.key, stage));
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, stageEnteredAt: rel(-3), createdAt: rel(-10), conversationArchivedAt: o.encerrada ? rel(-1) : null,
    scheduledAt: stage === "agendado" ? rel(o.futuro ?? 2) : null }).returning();
  if (o.last) await db.insert(messages).values({ contactId: c.id, dealId: d.id, direction: o.last, body: "x", status: o.last === "in" ? "received" : "sent", createdAt: rel(-1) });
  if (o.futuro != null) await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", startsAt: rel(o.futuro), status: "agendado", externalKey: `m:${n}:f` });
  if (o.veio != null) await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", startsAt: rel(-o.veio), status: "compareceu", externalKey: `m:${n}:v` });
  if (o.pacote) await db.insert(clientPackages).values({ contactId: c.id, packageName: "Hidratação", totalSessions: 10, usedSessions: 3, externalKey: `m:${n}:p` });
  if (o.tarefaVencida) await db.insert(tasks).values({ dealId: d.id, contactId: c.id, kind: "proxima_acao", title: "Retomar", dueAt: rel(-2) });
  return d.id;
}
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const target = (rows: Awaited<ReturnType<typeof planFunnelMigration>>, id: string) => rows.find((r) => r.dealId === id)!.target;

it("classify: horário futuro > veio em 30 dias > pacote > quem falou por último; Agendado sem horário vai para revisão", () => {
  const base = { kind: "atendimento", encerrada: false, attempt: 0, lastDir: "out" as const, futureId: null, visitAt: null, pacote: false };
  expect(classify({ ...base, futureId: "a", visitAt: new Date(), pacote: true }).target).toBe("agendado");
  expect(classify({ ...base, visitAt: new Date(), encerrada: true }).target).toBe("fechado");
  expect(classify({ ...base, visitAt: new Date() }).target).toBe("atendido");
  expect(classify({ ...base, pacote: true, lastDir: "in" }).target).toBe("followup");
  expect(classify({ ...base, lastDir: "in" }).target).toBe("fica");
  expect(classify({ ...base, kind: "followup", lastDir: "in" }).target).toBe("atendimento");
  expect(classify({ ...base, kind: "followup", attempt: 1 }).target).toBe("fica");
  expect(classify({ ...base, kind: "agendado" }).target).toBe("revisar");
  expect(classify({ ...base, kind: "agendado", futureId: "a" }).target).toBe("fica");
});

describe("migração das conversas (tabela da spec)", () => {
  it("ensaio não grava nada; aplicar põe cada conversa no lugar; rodar de novo não move mais nada", async () => {
    const futuro = await conversa("atendimento", { last: "out", futuro: 3 });
    const veioEnc = await conversa("atendimento", { last: "out", veio: 10, encerrada: true });
    const veio = await conversa("atendimento", { last: "out", veio: 10 });
    const pacote = await conversa("atendimento", { last: "in", pacote: true });
    const casa = await conversa("atendimento", { last: "out" });
    const cliente = await conversa("atendimento", { last: "in" });
    const fuCasa = await conversa("followup_1", { last: "out", tarefaVencida: true });
    const fuCliente = await conversa("followup_1", { last: "in" });
    const agOk = await conversa("agendado", { last: "out", futuro: 2 });
    const agSem = await conversa("agendado", { last: "out" });

    const plan = await planFunnelMigration(NOW);
    expect(Object.fromEntries([futuro, veioEnc, veio, pacote, casa, cliente, fuCasa, fuCliente, agOk, agSem].map((id) => [id, target(plan, id)]))).toEqual({
      [futuro]: "agendado", [veioEnc]: "fechado", [veio]: "atendido", [pacote]: "followup", [casa]: "followup",
      [cliente]: "fica", [fuCasa]: "followup", [fuCliente]: "atendimento", [agOk]: "fica", [agSem]: "revisar",
    });
    expect(summarize(plan).reduce((s, r) => s + r.conversas, 0)).toBe(10);
    expect(await stageOf(casa)).toBe("atendimento"); // ensaio: nada mudou

    const r = await applyFunnelMigration(plan, NOW);
    expect(r.failed).toEqual([]);
    expect(await stageOf(futuro)).toBe("agendado");
    expect(await stageOf(veioEnc)).toBe("atendida"); // nova organização: termina em Atendida (sem Fechado)
    expect((await db.select().from(deals).where(eq(deals.id, veioEnc)))[0].closedAt).not.toBeNull();
    expect(await stageOf(veio)).toBe("atendida");
    expect(await db.select().from(tasks).where(and(eq(tasks.dealId, veio), isNull(tasks.doneAt), eq(tasks.kind, "proxima_acao")))).toHaveLength(0); // visita antiga: sem pós
    expect(await stageOf(pacote)).toBe("atendimento"); // nova organização: esperando a cliente em Em conversa
    expect(await stageOf(casa)).toBe("atendimento");
    expect((await db.select().from(deals).where(eq(deals.id, casa)))[0].followupAttempt).toBe(1);
    expect(await stageOf(cliente)).toBe("atendimento");
    const [fc] = await db.select().from(deals).where(eq(deals.id, fuCasa));
    const [kept] = await db.select().from(tasks).where(eq(tasks.id, fc.followupTaskId!));
    expect(kept).toMatchObject({ title: "Retomar", doneAt: null }); // "mantendo a tarefa"
    expect(await stageOf(fuCliente)).toBe("atendimento");
    expect((await db.select().from(tasks).where(and(eq(tasks.dealId, fuCliente), isNull(tasks.doneAt))))[0].title).toBe(`Responder Cliente8`);
    expect(await stageOf(agSem)).toBe("agendado");

    const again = (await planFunnelMigration(NOW)).filter((x) => x.target !== "fica" && x.target !== "revisar");
    expect(again).toEqual([]);
  });

  it("decisão 4: sem conversa aberta, com horário e conversa nos últimos 30 dias, ganha cartão em Agendado", async () => {
    const [c] = await db.insert(contacts).values({ name: "Solta", phoneE164: "+5571966999999" }).returning();
    await db.insert(messages).values({ contactId: c.id, direction: "in", body: "oi", status: "received", createdAt: rel(-5) });
    await db.insert(appointments).values({ contactId: c.id, serviceLabel: "Corte", startsAt: rel(4), status: "agendado", externalKey: "m:solta" });
    const plan = await planFunnelMigration(NOW);
    expect(plan.find((r) => r.contactId === c.id)).toMatchObject({ dealId: null, target: "agendado", situation: "sem_conversa_aberta" });
    await applyFunnelMigration(plan, NOW);
    const [d] = await db.select().from(deals).where(eq(deals.contactId, c.id));
    expect(await stageOf(d.id)).toBe("agendado");
  });
});

describe("etapas", () => {
  it("renomeia, reordena e desativa Follow-up 2–4 só onde está no padrão antigo; o ensaio não grava; idempotente", async () => {
    // banco como o de produção antes do Lote 1C
    await db.update(stages).set({ name: "Lead" }).where(eq(stages.key, "lead"));
    await db.update(stages).set({ name: "Atendimento", staleDays: 1 }).where(eq(stages.key, "atendimento"));
    await db.update(stages).set({ name: "Follow-up 1", staleDays: 1, position: 3 }).where(eq(stages.key, "followup_1"));
    await db.update(stages).set({ active: true, staleDays: 1 }).where(eq(stages.key, "followup_2"));
    const dry = await migrateStagesConfig(false);
    expect(dry).toEqual(expect.arrayContaining(['Renomear "Lead" → "Novo contato"', 'Desativar "Follow-up 2"', "Limite parado de Em conversa: 1 → 2 dias"]));
    expect((await db.select().from(stages).where(eq(stages.key, "lead")))[0].name).toBe("Lead");
    await migrateStagesConfig(true);
    const rows = await db.select().from(stages);
    expect(rows.find((s) => s.key === "atendimento")).toMatchObject({ name: "Em conversa", staleDays: 2 });
    expect(rows.find((s) => s.key === "followup_1")).toMatchObject({ name: "Aguardando cliente", staleDays: null, position: 2 });
    expect(rows.find((s) => s.key === "followup_2")!.active).toBe(false);
    expect(await migrateStagesConfig(true)).toEqual([]);
  });

  it("nome editado pela gestão não é trocado", async () => {
    await db.update(stages).set({ name: "Conversando" }).where(eq(stages.key, "atendimento"));
    await migrateStagesConfig(true);
    expect((await db.select().from(stages).where(eq(stages.key, "atendimento")))[0].name).toBe("Conversando");
  });
});
