import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { appointments, appointmentSeries, auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import { assertFuncao } from "../funcoes";
import { dayOf } from "@/lib/agenda";
import { REPETIR_MIN_VEZES, REPETIR_PADRAO, REPETIR_TETO, semanasText, vezesText, type RepetirConfig } from "@/lib/repetir";
import { assertCanBook } from "./mode";
import { createVisitSchema, createVisitTx, ExistingAppointmentError, type CreateVisitInput } from "./visits";
import { afterAgendaChange } from "./notify";
import type { Actor } from "./actor";

/**
 * Repetir o horário (Fase C, item 23a): a mesma visita a cada X semanas, Y vezes, cada repetição pela porta de marcar (conflito, bloqueio,
 * folga e horário de trabalho). A primeira que não cabe derruba tudo; as seguintes que não cabem ficam de fora, com o texto do motor, e
 * nunca viram encaixe sem ninguém pedir (só a primeira pode usar "Encaixar mesmo assim").
 */
type Q = Tx | typeof db;
const KEY = "repetir";
const WEEK_MS = 7 * 86_400_000;

export type RepeatInput = { everyWeeks: number; times: number };
export type RecurringInput = CreateVisitInput & { repeat: RepeatInput };
export type RecurringResult = { seriesId: string; created: { day: string; visitId: string }[]; skipped: { day: string; reason: string }[] };

const inRange = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

/** Os limites da Casa (Configurações › Agenda e caixa › Repetir horário). Valor ausente ou estranho → o padrão (12 semanas, 26 vezes). */
export async function getRepetirConfig(q: Q = db): Promise<RepetirConfig> {
  const raw = (await q.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY)))[0]?.value;
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    maxSemanas: inRange(v.maxSemanas, 1, REPETIR_TETO.maxSemanas) ? v.maxSemanas : REPETIR_PADRAO.maxSemanas,
    maxVezes: inRange(v.maxVezes, REPETIR_MIN_VEZES, REPETIR_TETO.maxVezes) ? v.maxVezes : REPETIR_PADRAO.maxVezes,
  };
}

/** Muda os limites (quem pode, a action confere: config.sistema). Função `repetir`. Auditado com de/para. */
export async function saveRepetirConfig(input: RepetirConfig, userId: string): Promise<RepetirConfig> {
  await assertFuncao("repetir");
  if (!inRange(input?.maxSemanas, 1, REPETIR_TETO.maxSemanas)) throw new UserFacingError(`Use de 1 a ${REPETIR_TETO.maxSemanas} semanas.`);
  if (!inRange(input?.maxVezes, REPETIR_MIN_VEZES, REPETIR_TETO.maxVezes)) throw new UserFacingError(`Use de ${REPETIR_MIN_VEZES} a ${REPETIR_TETO.maxVezes} vezes.`);
  const value: RepetirConfig = { maxSemanas: input.maxSemanas, maxVezes: input.maxVezes };
  await db.transaction(async (tx) => {
    const before = await getRepetirConfig(tx);
    await tx.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: KEY, data: { de: before, para: value } });
  });
  return value;
}

/**
 * A chave do pedido de cada repetição: SHA-256 de "chave da série:k" no formato uuid (versão 8, variante RFC 4122), para passar no
 * `z.string().uuid()` do Marcar. O mesmo pedido gera sempre as mesmas chaves.
 */
export function derivedUuid(seriesRequestKey: string, k: number): string {
  const b = createHash("sha256").update(`${seriesRequestKey}:${k}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** O texto do motor para a lista "não couberam" ("Abrir o horário" é botão da tela, não motivo). */
const reasonOf = (e: UserFacingError) => (e instanceof ExistingAppointmentError ? e.message.replace(/\.?\s*Abrir o horário$/, "") : e.message);

/** O resultado gravado na auditoria da série: mandar o mesmo pedido de novo devolve o mesmo resultado, sem marcar nada. */
async function previousResult(tx: Tx, seriesId: string): Promise<RecurringResult> {
  const [a] = await tx.select({ data: auditLog.data }).from(auditLog)
    .where(and(eq(auditLog.action, "horario_repetido"), eq(auditLog.entity, "appointment_series"), eq(auditLog.entityId, seriesId))).limit(1);
  const d = (a?.data ?? {}) as { marcados?: RecurringResult["created"]; naoCouberam?: RecurringResult["skipped"] };
  return { seriesId, created: d.marcados ?? [], skipped: d.naoCouberam ?? [] };
}

/**
 * Marca a visita a cada `everyWeeks` semanas, `times` vezes, numa transação só; cada repetição num savepoint. A chave do pedido de cada
 * uma é `derivedUuid(requestKey, k)` e todos os horários criados ganham o `series_id`. Função `repetir`, modo da agenda e limites da Casa.
 */
export async function createRecurringVisits(raw: RecurringInput, actor: Actor, now = new Date()): Promise<RecurringResult> {
  const { repeat, ...visit } = raw;
  const base = createVisitSchema.parse(visit);
  const r = await db.transaction(async (tx) => {
    await assertFuncao("repetir", tx);
    await assertCanBook(tx);
    const cfg = await getRepetirConfig(tx);
    if (!inRange(repeat?.everyWeeks, 1, cfg.maxSemanas)) throw new UserFacingError(semanasText(cfg.maxSemanas));
    if (!inRange(repeat?.times, REPETIR_MIN_VEZES, cfg.maxVezes)) throw new UserFacingError(vezesText(cfg.maxVezes));
    // O mesmo pedido de novo (duplo toque, rede lenta): a série já existe; o segundo espera o primeiro terminar no índice único.
    const [series] = await tx.insert(appointmentSeries).values({ everyWeeks: repeat.everyWeeks, times: repeat.times, requestKey: base.requestKey, createdBy: actor.id, createdAt: now })
      .onConflictDoNothing({ target: appointmentSeries.requestKey }).returning({ id: appointmentSeries.id });
    if (!series) {
      const [had] = await tx.select({ id: appointmentSeries.id }).from(appointmentSeries).where(eq(appointmentSeries.requestKey, base.requestKey));
      return { ...(await previousResult(tx, had.id)), reused: true, dealIds: [] as string[] };
    }
    const created: RecurringResult["created"] = [], skipped: RecurringResult["skipped"] = [], dealIds: string[] = [];
    const first = new Date(base.startsAt).getTime();
    for (let k = 0; k < repeat.times; k++) {
      const startsAt = new Date(first + k * repeat.everyWeeks * WEEK_MS); // Salvador não tem horário de verão: a mesma hora toda semana
      const input: CreateVisitInput = { ...visit, requestKey: derivedUuid(base.requestKey, k), startsAt: startsAt.toISOString(),
        fitIn: k === 0 ? visit.fitIn : false, walkIn: k === 0 ? visit.walkIn : false };
      try {
        const v = await tx.transaction(async (sp) => {
          const res = await createVisitTx(sp, input, actor, now);
          await sp.update(appointments).set({ seriesId: series.id }).where(inArray(appointments.id, res.appointmentIds));
          return res;
        });
        created.push({ day: v.day, visitId: v.visitId });
        dealIds.push(...v.dealIds);
      } catch (e) {
        if (k === 0 || !(e instanceof UserFacingError)) throw e;
        skipped.push({ day: dayOf(startsAt), reason: reasonOf(e) });
      }
    }
    await tx.insert(auditLog).values({ userId: actor.id, action: "horario_repetido", entity: "appointment_series", entityId: series.id, createdAt: now,
      data: { pedido: base.requestKey, aCadaSemanas: repeat.everyWeeks, vezes: repeat.times, marcados: created, naoCouberam: skipped } });
    return { seriesId: series.id, created, skipped, reused: false, dealIds };
  });
  if (!r.reused) await afterAgendaChange(r.created.map((c) => c.day), r.dealIds);
  return { seriesId: r.seriesId, created: r.created, skipped: r.skipped };
}
