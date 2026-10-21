import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, commissionPayouts, professionalAdjustmentRules, professionalAdjustments, professionals, users } from "../../db/schema";
import { ADJUSTMENT_KINDS, ADJUSTMENT_LABEL, type AdjustmentKind, type AdjustmentRow, type AdjustmentRuleRow } from "@/lib/adjustments";
import { todayBahia } from "@/lib/agenda";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";
import { assertRecurso, getCaixaRecursos } from "./recursos";

/**
 * Vale, bônus e desconto na comissão (Fase A, Tarefa 8, decisão 13). Avulsos ou "todo mês no dia X" (1 a 28). Motivo obrigatório;
 * todo lançamento grava na auditoria quem, antes, depois e motivo. Quem lança é conferido na ação (`comissao.lancar`).
 */
export { ADJUSTMENT_KINDS, ADJUSTMENT_LABEL, type AdjustmentKind, type AdjustmentRow, type AdjustmentRuleRow };

const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v);
const isKind = (v: unknown): v is AdjustmentKind => ADJUSTMENT_KINDS.includes(v as AdjustmentKind);

function check(input: { kind: unknown; valueCents: unknown; note: unknown }): { note: string } {
  if (!isKind(input.kind)) throw new UserFacingError("Escolha Vale, Bônus ou Desconto na comissão.");
  if (!Number.isInteger(input.valueCents) || (input.valueCents as number) <= 0) throw new UserFacingError("Digite um valor maior que zero.");
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) : "";
  if (!note) throw new UserFacingError("Escreva o motivo.");
  return { note };
}

async function proName(q: Tx | Db, id: string): Promise<string> {
  const [p] = await q.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, id));
  if (!p) throw new UserFacingError("Profissional não encontrada.");
  return p.name;
}

export async function addAdjustment(input: { professionalId: string; kind: AdjustmentKind; valueCents: number; day: string; note: string }, actor: Actor, now = new Date()): Promise<{ id: string }> {
  const { note } = check(input);
  if (!isDay(input.day)) throw new UserFacingError("Escolha a data.");
  return db.transaction(async (tx) => {
    await assertRecurso("vales", tx);
    const pro = await proName(tx, input.professionalId);
    const [a] = await tx.insert(professionalAdjustments).values({ professionalId: input.professionalId, kind: input.kind, valueCents: input.valueCents, day: input.day, note, createdBy: actor.id, createdAt: now }).returning({ id: professionalAdjustments.id });
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "ajuste_lancado", entity: "professional_adjustment", entityId: a.id,
      data: { antes: null, depois: { profissional: pro, kind: input.kind, valueCents: input.valueCents, day: input.day }, motivo: note } });
    return a;
  });
}

/** Cancelar continua possível com o recurso desligado. Recusa o que já entrou num pagamento, o que veio de sangria e o saldo levado de um recibo. */
export async function cancelAdjustment(id: string, input: { reason: string }, actor: Actor, now = new Date()): Promise<void> {
  const reason = (input?.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new UserFacingError("Escreva o motivo.");
  await db.transaction(async (tx) => {
    const [a] = await tx.select().from(professionalAdjustments).where(eq(professionalAdjustments.id, id)).for("update");
    if (!a) throw new UserFacingError("Lançamento não encontrado.");
    if (a.cancelledAt) return;
    if (a.payoutId) throw new UserFacingError("Esse lançamento já entrou num pagamento. Desfaça o pagamento em Comissão antes.");
    if (a.cashMovementId) throw new UserFacingError("Cancele a sangria no caixa.");
    if (a.carriedFromPayoutId) {
      const [p] = await tx.select({ n: commissionPayouts.number }).from(commissionPayouts).where(eq(commissionPayouts.id, a.carriedFromPayoutId));
      throw new UserFacingError(`Este saldo vem do recibo nº ${p?.n ?? "?"}. Desfaça o recibo para mudar.`);
    }
    await cancelTx(tx, a.id, reason, actor.id, now);
  });
}

/** Cancela o lançamento (usado também quando a sangria de origem é cancelada). */
export async function cancelTx(tx: Tx, id: string, reason: string, userId: string, now: Date): Promise<void> {
  const [a] = await tx.update(professionalAdjustments).set({ cancelledAt: now, cancelledBy: userId, cancelReason: reason }).where(and(eq(professionalAdjustments.id, id), isNull(professionalAdjustments.cancelledAt))).returning();
  if (!a) return;
  await tx.insert(auditLog).values({ userId, createdAt: now, action: "ajuste_cancelado", entity: "professional_adjustment", entityId: id,
    data: { antes: { kind: a.kind, valueCents: a.valueCents, day: a.day, nota: a.note }, depois: null, motivo: reason } });
}

export type AdjustmentRuleInput = { id?: string | null; professionalId: string; kind: AdjustmentKind; valueCents: number; dayOfMonth: number; startsOn: string; endsOn?: string | null; note: string; active: boolean };

export async function saveAdjustmentRule(input: AdjustmentRuleInput, actor: Actor): Promise<{ id: string }> {
  const { note } = check(input);
  if (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 28) throw new UserFacingError("Use um dia de 1 a 28.");
  if (!isDay(input.startsOn)) throw new UserFacingError("Escolha quando começa.");
  const endsOn = input.endsOn || null;
  if (endsOn !== null && !isDay(endsOn)) throw new UserFacingError("Escolha quando termina.");
  if (endsOn !== null && endsOn < input.startsOn) throw new UserFacingError("O fim não pode ser antes do início.");
  return db.transaction(async (tx) => {
    await assertRecurso("vales", tx);
    const pro = await proName(tx, input.professionalId);
    const values = { professionalId: input.professionalId, kind: input.kind, valueCents: input.valueCents, dayOfMonth: input.dayOfMonth, startsOn: input.startsOn, endsOn, note, active: !!input.active };
    const view = (r: typeof values) => ({ profissional: pro, kind: r.kind, valueCents: r.valueCents, dayOfMonth: r.dayOfMonth, startsOn: r.startsOn, endsOn: r.endsOn, active: r.active });
    if (input.id) {
      const [old] = await tx.select().from(professionalAdjustmentRules).where(eq(professionalAdjustmentRules.id, input.id)).for("update");
      if (!old) throw new UserFacingError("Regra não encontrada.");
      await tx.update(professionalAdjustmentRules).set(values).where(eq(professionalAdjustmentRules.id, old.id));
      await tx.insert(auditLog).values({ userId: actor.id, action: "ajuste_regra", entity: "professional_adjustment_rule", entityId: old.id,
        data: { antes: view({ ...old, kind: old.kind as AdjustmentKind }), depois: view(values), motivo: note } });
      return { id: old.id };
    }
    const [r] = await tx.insert(professionalAdjustmentRules).values({ ...values, createdBy: actor.id }).returning({ id: professionalAdjustmentRules.id });
    await tx.insert(auditLog).values({ userId: actor.id, action: "ajuste_regra", entity: "professional_adjustment_rule", entityId: r.id, data: { antes: null, depois: view(values), motivo: note } });
    return r;
  });
}

/** Os meses entre dois dias "AAAA-MM-DD", inclusive: [[ano, mês]]. */
function monthsBetween(from: string, to: string): [number, number][] {
  const out: [number, number][] = [];
  let y = +from.slice(0, 4), m = +from.slice(5, 7);
  const ye = +to.slice(0, 4), me = +to.slice(5, 7);
  while (y < ye || (y === ye && m <= me)) { out.push([y, m]); if (++m > 12) { m = 1; y++; } }
  return out;
}

/**
 * Gera os "todo mês" até `untilDay` (idempotente: um por regra e dia). Chamada ao ler a tela e ao pagar. Com `vales` desligado não gera nada.
 * Devolve quantos criou.
 */
export async function materializeRulesTx(tx: Tx, untilDay: string, professionalId?: string, now = new Date()): Promise<number> {
  if (!(await getCaixaRecursos(tx)).vales) return 0;
  // Nunca gera o futuro, seja qual for o dia pedido (a URL da tela aceita qualquer data).
  const hoje = todayBahia(now);
  if (untilDay > hoje) untilDay = hoje;
  const rules = await tx.select().from(professionalAdjustmentRules).where(and(eq(professionalAdjustmentRules.active, true), lte(professionalAdjustmentRules.startsOn, untilDay),
    professionalId ? eq(professionalAdjustmentRules.professionalId, professionalId) : undefined));
  let n = 0;
  for (const r of rules) {
    const rows = monthsBetween(r.startsOn, untilDay)
      .map(([y, m]) => `${y}-${String(m).padStart(2, "0")}-${String(r.dayOfMonth).padStart(2, "0")}`)
      .filter((day) => day >= r.startsOn && day <= untilDay && (!r.endsOn || day <= r.endsOn))
      .map((day) => ({ professionalId: r.professionalId, kind: r.kind, valueCents: r.valueCents, day, note: r.note, ruleId: r.id, createdBy: r.createdBy }));
    if (!rows.length) continue;
    const made = await tx.insert(professionalAdjustments).values(rows).onConflictDoNothing().returning({ id: professionalAdjustments.id });
    for (const a of made) await tx.insert(auditLog).values({ userId: r.createdBy, action: "ajuste_lancado", entity: "professional_adjustment", entityId: a.id, data: { antes: null, depois: { regra: r.id, kind: r.kind, valueCents: r.valueCents }, motivo: r.note, automatico: true } });
    n += made.length;
  }
  return n;
}

export async function materializeRules(untilDay: string, professionalId?: string, now = new Date()): Promise<number> {
  return db.transaction((tx) => materializeRulesTx(tx, untilDay, professionalId, now));
}

/** Os lançamentos do período (inclusive os cancelados, marcados). */
export async function listAdjustments(o: { professionalId?: string; from: string; to: string }, q: Tx | Db = db): Promise<AdjustmentRow[]> {
  const rows = await q.select({ a: professionalAdjustments, pro: professionals.name, by: users.name }).from(professionalAdjustments)
    .innerJoin(professionals, eq(professionals.id, professionalAdjustments.professionalId)).leftJoin(users, eq(users.id, professionalAdjustments.createdBy))
    .where(and(gte(professionalAdjustments.day, o.from), lte(professionalAdjustments.day, o.to), o.professionalId ? eq(professionalAdjustments.professionalId, o.professionalId) : undefined))
    .orderBy(desc(professionalAdjustments.day), asc(professionalAdjustments.createdAt));
  return rows.map(({ a, pro, by }) => ({ id: a.id, professionalId: a.professionalId, professionalName: pro, kind: a.kind as AdjustmentKind, valueCents: a.valueCents, day: a.day, note: a.note,
    ruleId: a.ruleId, fromSangria: !!a.cashMovementId, paid: !!a.payoutId, cancelledAt: a.cancelledAt?.toISOString() ?? null, createdByName: by ? by.split(/\s+/)[0] : null }));
}

export async function listAdjustmentRules(q: Tx | Db = db): Promise<AdjustmentRuleRow[]> {
  const rows = await q.select({ r: professionalAdjustmentRules, pro: professionals.name }).from(professionalAdjustmentRules)
    .innerJoin(professionals, eq(professionals.id, professionalAdjustmentRules.professionalId)).orderBy(asc(professionals.name), asc(professionalAdjustmentRules.dayOfMonth));
  return rows.map(({ r, pro }) => ({ id: r.id, professionalId: r.professionalId, professionalName: pro, kind: r.kind as AdjustmentKind, valueCents: r.valueCents, dayOfMonth: r.dayOfMonth,
    startsOn: r.startsOn, endsOn: r.endsOn, note: r.note, active: r.active }));
}
