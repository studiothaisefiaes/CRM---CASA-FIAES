import { it, expect, beforeEach } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db"; import { alerts, dealEvents, deals, tasks, users, lists } from "../db/schema";
import { recordInbound } from "./deals"; import { updateDeal, closeSale, setAttendance } from "./updates";
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
  const open = () => db.select().from(tasks).where(and(eq(tasks.kind, "comparecimento"), isNull(tasks.doneAt)));
  let rows = await open();
  expect(rows).toHaveLength(1); expect(rows[0].dueAt.toISOString().slice(0, 10)).toBe("2026-10-21");
  await updateDeal(dealId, { scheduledAt: "" }, uid);
  expect(await open()).toHaveLength(0);
  expect(await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"))).toHaveLength(2); // canceladas, não apagadas
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
  expect(await remindDueTasks(now)).toEqual({ alerts: 1 });
  expect(await remindDueTasks(new Date(now.getTime() + 5 * 60_000))).toEqual({ alerts: 0 });
  const [a] = await db.select().from(alerts);
  expect(a).toMatchObject({ type: "tarefa_vencendo", level: 1, waitKey: `task:${soon.id}`, userId: uid, audience: "responsavel", dealId });
  await completeTask(soon.id, uid);
  expect((await db.select().from(alerts))[0].resolvedAt).not.toBeNull();
});
it("marcar comparecimento conclui a tarefa de comparecimento e o aviso dela", async () => {
  await updateDeal(dealId, { scheduledAt: "2026-10-15T13:00:00.000Z" }, uid);
  const [t] = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  await remindDueTasks(new Date(t.dueAt.getTime() - 60_000));
  expect((await db.select().from(alerts)).filter((a) => !a.resolvedAt)).toHaveLength(1);
  await setAttendance(dealId, "compareceu", uid);
  const [after] = await db.select().from(tasks).where(eq(tasks.id, t.id));
  expect(after.doneAt).not.toBeNull();
  expect((await db.select().from(alerts)).every((a) => a.resolvedAt)).toBe(true);
  const ev = (await db.select().from(dealEvents).where(eq(dealEvents.type, "tarefa"))).map((e) => (e.payload as { acao: string }).acao);
  expect(ev).toContain("concluida");
});
it("lembrete: tarefa já vencida avisa (até 2 dias); mais antiga que isso não", async () => {
  const now = new Date("2026-10-14T15:00:00Z");
  await createTask({ dealId, contactId, kind: "geral", title: "Atrasada 1h", dueAt: new Date(now.getTime() - 3_600_000), assigneeId: uid }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "Atrasada 3d", dueAt: new Date(now.getTime() - 3 * 86_400_000), assigneeId: uid }, uid);
  expect(await remindDueTasks(now)).toEqual({ alerts: 1 });
  expect(await remindDueTasks(now)).toEqual({ alerts: 0 });
  expect((await db.select().from(alerts))[0].message).toContain("Atrasada 1h");
});
it("remarcar cancela a tarefa antiga (não apaga), resolve o aviso e cria a nova", async () => {
  await updateDeal(dealId, { scheduledAt: "2026-10-15T13:00:00.000Z" }, uid);
  const [old] = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  await remindDueTasks(new Date(old.dueAt.getTime() - 60_000));
  await updateDeal(dealId, { scheduledAt: "2026-10-22T13:00:00.000Z" }, uid);
  const all = await db.select().from(tasks).where(eq(tasks.kind, "comparecimento"));
  expect(all).toHaveLength(2);
  expect(all.find((t) => t.id === old.id)!.doneAt).not.toBeNull();
  expect(all.filter((t) => !t.doneAt)).toHaveLength(1);
  expect((await db.select().from(alerts)).every((a) => a.resolvedAt)).toBe(true);
  const ev = (await db.select().from(dealEvents).where(eq(dealEvents.type, "tarefa"))).map((e) => (e.payload as { acao: string }).acao);
  expect(ev).toContain("cancelada");
});
it("lembrete de tarefa sem responsável vai para a gestão", async () => {
  const now = new Date("2026-10-14T15:00:00Z");
  const t = await createTask({ dealId, contactId, kind: "geral", title: "Sem dono", dueAt: new Date("2026-10-14T15:05:00Z") }, uid);
  expect(await remindDueTasks(now)).toEqual({ alerts: 1 });
  expect((await db.select().from(alerts))[0]).toMatchObject({ audience: "gestao", userId: null, waitKey: `task:${t.id}`, type: "tarefa_vencendo" });
});
