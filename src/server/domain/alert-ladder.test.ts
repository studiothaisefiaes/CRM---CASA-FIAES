import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, automations, deals, users } from "../db/schema";
import { recordInbound } from "./deals";
import { createTask, completeTask, remindDueTasks } from "./tasks";
import { hasOpenAlert, sweepAlerts } from "./alert-actions";
import { archiveConversation } from "./conversation-archive";
import { runRules } from "../rules/engine";
import { resetDb } from "../../../test/db";

// Fadiga de alerta (pesquisa 20/10): um aviso por conversa e por motivo, degraus selo → vermelho → gestão, e o que não vale mais sai sozinho.
const TUE = new Date("2026-10-13T13:00:00Z"); // terça, 10h em Salvador (Casa aberta)
const at = (h: number) => new Date(TUE.getTime() + h * 3_600_000);
const others = () => db.select().from(alerts).where(ne(alerts.type, "mensagem_cliente"));
const open = async () => (await others()).filter((a) => !a.resolvedAt);
let uid = ""; let dealId = ""; let contactId = "";

beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "F1", phoneRaw: "71999994444", body: "oi", at: at(-48) });
  if (!("dealId" in r)) throw new Error();
  dealId = r.dealId;
  contactId = (await db.query.deals.findFirst({ where: (d, { eq }) => eq(d.id, dealId) }))!.contactId;
});

it("dois combinados vencendo na mesma conversa: um aviso só; o segundo avisa quando o primeiro é concluído", async () => {
  const t1 = await createTask({ dealId, contactId, kind: "geral", title: "Mandar valores", dueAt: at(0), assigneeId: uid }, uid);
  await createTask({ dealId, contactId, kind: "geral", title: "Mandar fotos", dueAt: at(0.1), assigneeId: uid }, uid);
  expect(await remindDueTasks(at(0))).toEqual({ alerts: 1 });
  expect(await remindDueTasks(at(0.2))).toEqual({ alerts: 0 });
  expect(await open()).toHaveLength(1);
  await completeTask(t1.id, uid);
  expect(await remindDueTasks(at(0.3))).toEqual({ alerts: 1 });
  const left = await open();
  expect(left).toHaveLength(1);
  expect(left[0].message).toMatch(/mandar fotos/i);
});

it("regra de parada não repete o aviso enquanto o anterior está aberto", async () => {
  await db.update(automations).set({ enabled: false }).where(ne(automations.key, "parado_etapa"));
  await db.update(deals).set({ awaitingReplySince: null, lastOutboundAt: at(-47), stageEnteredAt: at(-30 * 24) }).where(eq(deals.id, dealId));
  const [rule] = await db.select({ id: automations.id }).from(automations).where(eq(automations.key, "parado_etapa"));
  // A chave do aviso de regra começa pelo id da regra (o motivo): um aviso antigo da mesma regra, de outra janela.
  await db.insert(alerts).values({ dealId, userId: uid, audience: "responsavel", type: "parado_dias", severity: "info", message: "antigo", dedupeKey: `${rule.id}:${dealId}:etapa:antiga:alertar_responsavel`, createdAt: at(-5) });
  expect(await hasOpenAlert(db, dealId, "parado_dias")).toBe(true);
  await runRules(at(0));
  expect((await open()).map((a) => a.message)).toEqual(["antigo"]);
  // Sem o aviso aberto, a mesma regra avisaria (o teste acima não passa por falta de candidato).
  await db.delete(alerts);
  await db.execute(sql`truncate automation_runs`);
  await runRules(at(0));
  expect((await open()).map((a) => a.type)).toEqual(["parado_dias"]);
});

it("degraus: 1 dia de expediente aberto fica vermelho, 2 dias sobe para a gestão (sem voltar a não lido, sem aviso novo)", async () => {
  const t = await createTask({ dealId, contactId, kind: "geral", title: "Ligar", dueAt: at(0), assigneeId: uid }, uid);
  await remindDueTasks(at(0));
  await db.update(alerts).set({ readAt: at(1) }).where(eq(alerts.waitKey, `task:${t.id}`));
  expect(await sweepAlerts(at(2))).toMatchObject({ red: 0, gestao: 0 });
  expect(await sweepAlerts(at(24))).toMatchObject({ red: 1, gestao: 0 }); // quarta
  let [a] = await open();
  expect(a).toMatchObject({ severity: "urgente", level: 1, audience: "responsavel" });
  expect(await sweepAlerts(at(48))).toMatchObject({ red: 0, gestao: 1 }); // quinta
  [a] = await open();
  expect(a).toMatchObject({ severity: "urgente", level: 2, audience: "gestao", userId: uid });
  expect(a.readAt).not.toBeNull();
  expect(await others()).toHaveLength(1);
  expect(await sweepAlerts(at(72))).toMatchObject({ red: 0, gestao: 0 }); // não sobe de novo
});

it("degraus não andam com a Casa fechada (domingo)", async () => {
  await createTask({ dealId, contactId, kind: "geral", title: "Ligar", dueAt: at(0), assigneeId: uid }, uid);
  await remindDueTasks(at(0));
  expect(await sweepAlerts(new Date("2026-10-18T15:00:00Z"))).toEqual({ duplicates: 0, stale: 0, red: 0, gestao: 0 });
});

it("repetidos do legado: fica só o mais novo de cada conversa e motivo", async () => {
  const [rule] = await db.select({ id: automations.id }).from(automations).where(eq(automations.key, "parado_etapa"));
  const mk = (key: string, h: number, type = "parado_dias", ruleId = rule.id) => db.insert(alerts).values({ dealId, userId: uid, audience: "responsavel", type, severity: "info", message: key, dedupeKey: `${ruleId}:${dealId}:${key}`, createdAt: at(h) });
  await mk("p1", -3); await mk("p2", -2); await mk("p3", -1);
  await mk("outra-regra", -2, "parado_dias", "00000000-0000-4000-8000-00000000abcd"); // outra regra = outro motivo: fica
  await mk("aniv", -1, "aniversario_em_dias");
  await db.update(deals).set({ stageEnteredAt: at(-30 * 24) }).where(eq(deals.id, dealId));
  expect(await sweepAlerts(at(0))).toMatchObject({ duplicates: 2 });
  expect((await open()).map((a) => a.message).sort()).toEqual(["aniv", "outra-regra", "p3"]);
});

it("parada que não vale mais sai sozinha: ganhou próximo passo marcado, ou a conversa foi resolvida", async () => {
  await db.update(deals).set({ stageEnteredAt: at(-30 * 24) }).where(eq(deals.id, dealId));
  await db.insert(alerts).values({ dealId, userId: uid, audience: "responsavel", type: "parado_dias", severity: "info", message: "parada", dedupeKey: "p", createdAt: at(-1) });
  expect(await sweepAlerts(at(0))).toMatchObject({ stale: 0 });
  await createTask({ dealId, contactId, kind: "proxima_acao", title: "Retomar", dueAt: at(30), assigneeId: uid }, uid);
  expect(await sweepAlerts(at(0.5))).toMatchObject({ stale: 1 });
  expect(await open()).toHaveLength(0);
});

it("resolver a conversa resolve todos os avisos dela (combinado, parada, a cliente escreveu)", async () => {
  await createTask({ dealId, contactId, kind: "geral", title: "Ligar", dueAt: at(0), assigneeId: uid }, uid);
  await remindDueTasks(at(0));
  await db.insert(alerts).values({ dealId, userId: uid, audience: "responsavel", type: "parado_dias", severity: "info", message: "parada", dedupeKey: "p", createdAt: at(-1) });
  expect((await db.select().from(alerts).where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)))).length).toBeGreaterThanOrEqual(2);
  await archiveConversation(dealId, uid);
  expect(await db.select().from(alerts).where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt)))).toHaveLength(0);
});
