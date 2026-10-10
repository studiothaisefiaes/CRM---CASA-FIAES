import { it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { alerts, deals, tasks, users, lists } from "../db/schema";
import { recordInbound } from "./deals"; import { updateDeal, closeSale } from "./updates";
import { createTask, completeTask, listTasks, nextActionOf, nextDayMorning, remindDueTasks } from "./tasks"; import { resetDb } from "../../../test/db";
let uid = ""; let dealId = ""; let contactId = "";
beforeEach(async () => { await resetDb(); [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "T1", phoneRaw: "71999993333", body: "oi" }); if (!("dealId" in r)) throw new Error(); dealId = r.dealId;
  contactId = (await db.query.deals.findFirst({ where: (d, { eq }) => eq(d.id, dealId) }))!.contactId; });
it("próxima ação com data e responsável", async () => {
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Mandar valores", dueAt: new Date("2026-10-14T12:00:00Z"), assigneeId: uid }, uid);
  expect(await nextActionOf(dealId)).toMatchObject({ title: "Mandar valores", assigneeId: uid });
});
it("a próxima ação é a aberta mais próxima", async () => {
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Depois", dueAt: new Date("2026-10-20T12:00:00Z") }, uid);
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Antes", dueAt: new Date("2026-10-14T12:00:00Z") }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "Outra coisa", dueAt: new Date("2026-10-01T12:00:00Z") }, uid);
  expect((await nextActionOf(dealId))!.title).toBe("Antes");
});
it("agendar cria comparecimento no dia seguinte (fuso de Salvador)", async () => {
  await updateDeal(dealId, { scheduledAt: "2026-10-15T13:00:00.000Z" }, uid);
  const [t] = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  expect(t.dueAt.toISOString().slice(0, 10)).toBe("2026-10-16");
  expect(t.dealId).toBe(dealId);
});
it("dia seguinte conta no fuso de Salvador, não em UTC", () => {
  // 22h de Salvador no dia 15 já é dia 16 em UTC; o "dia seguinte" continua sendo o 16.
  expect(nextDayMorning(new Date("2026-10-16T01:00:00Z")).toISOString()).toBe("2026-10-16T12:00:00.000Z");
});
it("remarcar substitui o comparecimento aberto; limpar o agendamento remove", async () => {
  await updateDeal(dealId, { scheduledAt: "2026-10-15T13:00:00.000Z" }, uid);
  await updateDeal(dealId, { scheduledAt: "2026-10-20T13:00:00.000Z" }, uid);
  let rows = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  expect(rows).toHaveLength(1); expect(rows[0].dueAt.toISOString().slice(0, 10)).toBe("2026-10-21");
  await updateDeal(dealId, { scheduledAt: "" }, uid);
  rows = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  expect(rows).toHaveLength(0);
});
it("venda de serviço com ciclo cria retorno", async () => {
  const [col] = await db.select().from(lists).where(eq(lists.label, "Coloração"));
  await closeSale(dealId, { serviceId: col.id, valueCents: 30000, paymentMethod: "pix", paidNow: true }, uid);
  const [t] = await db.select().from(tasks).where(eq(tasks.kind, "retorno"));
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(t.dueAt.getTime()).toBe(d.closedAt!.getTime() + 35 * 86_400_000);
});
it("venda de serviço sem ciclo não cria retorno; fechar de novo não duplica", async () => {
  const [corte] = await db.select().from(lists).where(eq(lists.label, "Corte"));
  await closeSale(dealId, { serviceId: corte.id, valueCents: 8000, paymentMethod: "pix", paidNow: true }, uid);
  expect(await db.select().from(tasks).where(eq(tasks.kind, "retorno"))).toHaveLength(0);
  const [col] = await db.select().from(lists).where(eq(lists.label, "Coloração"));
  const r = await recordInbound({ channelId: null, externalId: "T2", phoneRaw: "71999994444", body: "oi" }); if (!("dealId" in r)) throw new Error();
  await closeSale(r.dealId, { serviceId: col.id, valueCents: 30000, paymentMethod: "pix", paidNow: true }, uid);
  await closeSale(r.dealId, { serviceId: col.id, valueCents: 30000, paymentMethod: "pix", paidNow: true }, uid);
  expect(await db.select().from(tasks).where(eq(tasks.kind, "retorno"))).toHaveLength(1);
});
it("concluir tira da lista", async () => {
  const t = await createTask({ dealId, contactId, kind: "proxima_acao", title: "x", dueAt: new Date() }, uid);
  expect(await nextActionOf(dealId)).not.toBeNull();
  await completeTask(t.id, uid);
  expect(await nextActionOf(dealId)).toBeNull();
  await completeTask(t.id, uid); // idempotente
});
it("listTasks filtra por responsável e prazo, só abertas", async () => {
  await createTask({ dealId, contactId, kind: "geral", title: "a", dueAt: new Date("2026-10-14T12:00:00Z"), assigneeId: uid }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "b", dueAt: new Date("2026-10-30T12:00:00Z"), assigneeId: uid }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "c", dueAt: new Date("2026-10-14T12:00:00Z") }, uid);
  const l = await listTasks({ assigneeId: uid, dueBefore: new Date("2026-10-20T00:00:00Z"), open: true });
  expect(l.map((t) => t.title)).toEqual(["a"]);
});
it("lembrete: tarefa vencendo em 15 min avisa o responsável uma vez; concluir resolve o aviso", async () => {
  const now = new Date("2026-10-14T15:00:00Z");
  const soon = await createTask({ dealId, contactId, kind: "proxima_acao", title: "Ligar", dueAt: new Date("2026-10-14T15:10:00Z"), assigneeId: uid }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "Longe", dueAt: new Date("2026-10-14T16:00:00Z"), assigneeId: uid }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "Sem dono", dueAt: new Date("2026-10-14T15:05:00Z") }, uid);
  expect(await remindDueTasks(now)).toEqual({ alerts: 1 });
  expect(await remindDueTasks(new Date(now.getTime() + 5 * 60_000))).toEqual({ alerts: 0 });
  const [a] = await db.select().from(alerts);
  expect(a).toMatchObject({ type: "tarefa_vencendo", level: 1, waitKey: `task:${soon.id}`, userId: uid, audience: "responsavel", dealId });
  await completeTask(soon.id, uid);
  expect((await db.select().from(alerts))[0].resolvedAt).not.toBeNull();
});
