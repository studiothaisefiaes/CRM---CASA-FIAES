import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { appointments, contactStats, contacts, deals, lists, messages, settings, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { RETORNO_LOST_REASON, RETORNO_ORIGIN, getSuggestedReturnSetting, planSuggestedReturns, setSuggestedReturnSetting, sweepSuggestedReturns } from "./suggested-return";
import { addDaysTo } from "../../lib/client-rhythm";

const NOW = new Date("2026-10-15T11:00:00Z"); // quinta, 8h em Salvador (a hora da varredura)
const HOJE = "2026-10-15";
let seq = 0, ana = "";

/** Ritmo de 40 dias, última visita há `dias` e (por padrão) uma mensagem com a Casa há 60 dias. */
async function cliente(name: string, dias = 45, o: { phone?: string; ignored?: boolean; conversa?: boolean } = {}) {
  const [c] = await db.insert(contacts).values({ name, phoneE164: o.phone ?? `+5571968${String(++seq).padStart(6, "0")}`, ignored: o.ignored ?? false }).returning();
  const last = addDaysTo(HOJE, -dias);
  await db.insert(contactStats).values({ contactId: c.id, visits: 5, lastVisitOn: last, rhythmDays: 40, returnDueOn: addDaysTo(last, 40) });
  if (o.conversa !== false) await db.insert(messages).values({ contactId: c.id, direction: "in", body: "oi", status: "received", createdAt: new Date(NOW.getTime() - 60 * 86_400_000) });
  return c.id;
}
const liga = (maxPorDia = 20) => db.insert(settings).values({ key: "retorno_sugerido", value: { ativo: true, maxPorDia } })
  .onConflictDoUpdate({ target: settings.key, set: { value: { ativo: true, maxPorDia } } });
const cartoes = (contactId: string) => db.select({ id: deals.id, kind: stages.kind, closedAt: deals.closedAt, origin: deals.origin, ownerId: deals.ownerId })
  .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.contactId, contactId));
const retornoDe = async (contactId: string) => (await cartoes(contactId)).find((d) => d.origin === RETORNO_ORIGIN)!;

beforeEach(async () => {
  seq = 0;
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana-r@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  // A Casa abre ter–sáb, 9h–18h (Lote 0)
  const dia = ["09:00", "18:00"];
  await db.insert(settings).values({ key: "business_hours", value: { 0: null, 1: null, 2: dia, 3: dia, 4: dia, 5: dia, 6: dia } });
});

it("nasce desligado: sem a gestão ligar, nada acontece", async () => {
  await cliente("Rita Fictícia");
  expect(await getSuggestedReturnSetting()).toEqual({ ativo: false, maxPorDia: 20 });
  expect(await sweepSuggestedReturns(NOW)).toMatchObject({ criados: 0, desligado: true });
  expect(await db.select().from(deals)).toHaveLength(0);
});

it("ligado: a data prevista chegou → cartão em Retorno sugerido com o combinado da dona da última conversa; nada é enviado", async () => {
  const id = await cliente("Rita Fictícia", 45); // previsto há 5 dias; ainda "na hora" (≤ 1,5 × 40)
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  await db.insert(deals).values({ contactId: id, stageId: fechado.id, ownerId: ana, closedAt: new Date(NOW.getTime() - 50 * 86_400_000), createdAt: new Date(NOW.getTime() - 52 * 86_400_000) });
  await liga();
  expect(await sweepSuggestedReturns(NOW)).toMatchObject({ criados: 1, erros: [] });
  const novo = await retornoDe(id);
  expect(novo).toMatchObject({ kind: "retorno", ownerId: ana, closedAt: null });
  const [t] = await db.select().from(tasks).where(and(eq(tasks.dealId, novo.id), isNull(tasks.doneAt)));
  expect(t).toMatchObject({ kind: "proxima_acao", assigneeId: ana, title: "Chamar Rita para voltar (prevista 10/10)" });
  expect(t.dueAt.toISOString()).toBe("2026-10-15T13:00:00.000Z"); // hoje, 10h
  expect(await db.select().from(messages).where(eq(messages.direction, "out"))).toHaveLength(0);
});

it("não cria duas vezes nem para quem não deve (conversa aberta, horário no Avec, Não é cliente, número oculto, sem conversa no último ano, sumida, cedo, já teve retorno neste ciclo)", async () => {
  const ok = await cliente("Pode Entrar", 45);
  const aberta = await cliente("Com Conversa Aberta", 45);
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values({ contactId: aberta, stageId: lead.id });
  const horario = await cliente("Com Horário", 45);
  await db.insert(appointments).values({ contactId: horario, startsAt: new Date(NOW.getTime() + 5 * 86_400_000), status: "agendado", serviceLabel: "Escova", externalKey: "t:r1" });
  await cliente("Não É Cliente", 45, { ignored: true });
  await cliente("Número Oculto", 45, { phone: "lid:123456" });
  await cliente("Sem Conversa", 45, { conversa: false });
  await cliente("Já Sumida", 61);
  await cliente("Ainda Não", 30);
  await liga();
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(1);
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(0); // de novo no mesmo dia
  expect((await cartoes(ok)).filter((d) => d.kind === "retorno")).toHaveLength(1);
  await db.update(deals).set({ closedAt: NOW }).where(eq(deals.contactId, ok)); // o cartão foi fechado; a volta ainda é do mesmo ciclo
  expect((await sweepSuggestedReturns(new Date(NOW.getTime() + 86_400_000))).criados).toBe(0);
});

it("teto por dia e só em dia que a Casa abre (segunda fechada: nada)", async () => {
  for (let i = 0; i < 3; i++) await cliente(`Cliente${i} Fictícia`, 45);
  await liga(2);
  expect((await sweepSuggestedReturns(new Date("2026-10-19T11:00:00Z"))).criados).toBe(0); // segunda-feira
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(2);
  expect((await sweepSuggestedReturns(NOW)).criados).toBe(0);
});

it("depois: marcou → Agendado; a Casa escreveu e ela não respondeu em 4 h → Em conversa esperando a cliente; 14 dias sem a Casa escrever → Perdido 'Retorno não feito'", async () => {
  const marcou = await cliente("Marcou Fictícia", 45);
  const escreveu = await cliente("Casa Escreveu", 45);
  const parada = await cliente("Ninguém Chamou", 45);
  await liga();
  await sweepSuggestedReturns(NOW);
  await db.insert(appointments).values({ contactId: marcou, startsAt: new Date(NOW.getTime() + 3 * 86_400_000), status: "agendado", serviceLabel: "Escova", externalKey: "t:r2" });
  const d2 = await retornoDe(escreveu);
  const saiu = new Date(NOW.getTime() + 3_600_000);
  await db.insert(messages).values({ contactId: escreveu, dealId: d2.id, direction: "out", body: "Oi! Vamos marcar?", status: "sent", createdAt: saiu });
  await db.update(deals).set({ lastOutboundAt: saiu }).where(eq(deals.id, d2.id));
  expect(await sweepSuggestedReturns(new Date(NOW.getTime() + 86_400_000))).toMatchObject({ pelaAgenda: 1, aguardando: 1, expirados: 0 });
  expect((await retornoDe(marcou)).kind).toBe("agendado");
  expect((await retornoDe(escreveu)).kind).toBe("atendimento");
  expect((await db.select().from(deals).where(eq(deals.id, d2.id)))[0].followupAttempt).toBe(1);
  expect((await sweepSuggestedReturns(new Date(NOW.getTime() + 15 * 86_400_000))).expirados).toBe(1);
  const perdido = await retornoDe(parada);
  expect(perdido.kind).toBe("perdido");
  const [motivo] = await db.select().from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.label, RETORNO_LOST_REASON)));
  expect((await db.select().from(deals).where(eq(deals.id, perdido.id)))[0].lostReasonId).toBe(motivo.id);
  expect(await db.select().from(tasks).where(and(eq(tasks.dealId, perdido.id), isNull(tasks.doneAt)))).toHaveLength(0);
});

it("o ensaio lista quem entraria hoje, a mais atrasada primeiro, sem gravar", async () => {
  await cliente("Atrasada Cinco", 45);
  await cliente("Atrasada Dez", 50);
  expect((await planSuggestedReturns(NOW, 10)).map((p) => p.name)).toEqual(["Atrasada Dez", "Atrasada Cinco"]);
  expect(await db.select().from(deals)).toHaveLength(0);
});

it("ligar fica gravado (com o teto) e auditado", async () => {
  expect(await setSuggestedReturnSetting(true, ana)).toEqual({ ativo: true, maxPorDia: 20 });
  expect((await getSuggestedReturnSetting()).ativo).toBe(true);
});
