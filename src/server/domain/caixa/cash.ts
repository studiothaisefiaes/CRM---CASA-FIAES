import { and, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, cashMovements, cashSessions, comandaItems, comandaPayments, comandas, professionalAdjustments, professionals, profiles, users, type CashSession } from "../../db/schema";
import { cashDifference, changeFor, comandaTotals, expectedByMethod, isCardMethod, needsApprovalByMethod, type DrawerMethod, type PayMethod } from "@/lib/comanda-math";
import { sumDenominations } from "@/lib/cash-denominations";
import { can, isPerm, type Perm } from "@/lib/permissions";
import { todayBahia } from "@/lib/agenda";
import { money } from "@/lib/format";
import { isBlindFor } from "@/lib/caixa-settings";
import { firstName } from "@/lib/authorship";
import { teamNameOf } from "../../queries/team-name";
import { lockKeyTx } from "../agenda/locks";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";
import { assertCaixaOn, getCaixaRules } from "./mode";
import { assertRecurso, getCaixaRecursos } from "./recursos";
import { cancelTx } from "./adjustments";
import { allow, resetLimit } from "../../auth/rate-limit";
import { checkCredentials } from "../../auth/users";

type Q = Tx | Db;
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
/** Trava do caixa de uma pessoa (Plano 3: cada uma abre e fecha o seu). */
const cashLock = (userId: string) => `caixa:sessao:${userId}`;

/** Comanda com item vivo ou pagamento vivo (a vazia nunca é pendência: QA r58, I-8). `id` = a coluna do id da comanda na consulta. */
export const notEmptySql = (id: SQL) => sql`(exists (select 1 from comanda_items ci0 where ci0.comanda_id = ${id} and ci0.cancelled_at is null)
  or exists (select 1 from comanda_payments cp0 where cp0.comanda_id = ${id} and cp0.cancelled_at is null))`;

/** O caixa aberto DESSA pessoa (null se ela não abriu). */
export async function getOpenCashTx(q: Q, userId: string): Promise<CashSession | null> {
  const [s] = await q.select().from(cashSessions).where(and(eq(cashSessions.status, "aberto"), eq(cashSessions.openedBy, userId))).limit(1);
  return s ?? null;
}

/**
 * O caixa aberto da pessoa, travado para leitura (FOR SHARE): quem recebe espera um fechamento em andamento terminar e, se o caixa fechou,
 * o pagamento fica sem caixa (nunca entra num caixa já fechado, fora do esperado gravado).
 */
export async function lockOpenCashTx(tx: Tx, userId: string): Promise<CashSession | null> {
  const [s] = await tx.select().from(cashSessions).where(and(eq(cashSessions.status, "aberto"), eq(cashSessions.openedBy, userId))).limit(1).for("share");
  return s ?? null;
}

/** A pessoa tem a permissão pelo perfil dela (quem aprova a diferença do fechamento não é quem está logada). */
export async function userHasPerm(userId: string, perm: Perm, q: Q = db): Promise<boolean> {
  const [u] = await q.select({ active: users.active, perms: profiles.permissions }).from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, userId));
  return !!u?.active && can((u.perms ?? []).filter(isPerm), perm);
}

/** "Abrir caixa, {nome}" com o fundo de troco. Um aberto por pessoa (o índice garante). */
export async function openCash(input: { openingCents: number; notes?: string | null }, actor: Actor, now = new Date()): Promise<{ id: string }> {
  if (!Number.isInteger(input.openingCents) || input.openingCents < 0) throw new UserFacingError("Digite o fundo de troco (pode ser zero).");
  return db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    await lockKeyTx(tx, cashLock(actor.id));
    const open = await getOpenCashTx(tx, actor.id);
    if (open) throw new UserFacingError(`Seu caixa já está aberto (desde ${HORA.format(open.openedAt)}).`);
    const [s] = await tx.insert(cashSessions).values({ day: todayBahia(now), openingCents: input.openingCents, openedBy: actor.id, openedAt: now, notes: input.notes?.trim() || null }).returning({ id: cashSessions.id });
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "caixa_aberto", entity: "cash_session", entityId: s.id, data: { trocoInicial: input.openingCents } });
    return s;
  });
}

export type CashSummary = {
  session: CashSession; ownerName: string | null; openingCents: number;
  /** Pagamentos vivos que entraram neste caixa, por forma; o dinheiro já sem o troco devolvido. */
  received: { method: PayMethod; valueCents: number }[];
  byBrand: { method: "credito" | "debito"; brand: string; valueCents: number }[];
  suprimentosCents: number; sangriasCents: number; expected: Record<DrawerMethod, number>; openComandas: number;
};

/** O caixa de uma pessoa: o que entrou nele (pelo pagamento, não pela comanda), os movimentos e o esperado por forma. */
export async function cashSummary(sessionId: string, q: Q = db): Promise<CashSummary> {
  const [row] = await q.select({ s: cashSessions, owner: teamNameOf(cashSessions.openedBy) }).from(cashSessions).where(eq(cashSessions.id, sessionId));
  if (!row) throw new UserFacingError("Caixa não encontrado.");
  const live = and(eq(comandaPayments.cashSessionId, sessionId), isNull(comandaPayments.cancelledAt), ne(comandas.status, "cancelada"));
  const net = sql<number>`sum(${comandaPayments.valueCents} - ${comandaPayments.changeCents})::int`;
  const received = await q.select({ method: comandaPayments.method, valueCents: net }).from(comandaPayments).innerJoin(comandas, eq(comandas.id, comandaPayments.comandaId))
    .where(live).groupBy(comandaPayments.method);
  const brands = await q.select({ method: comandaPayments.method, brand: comandaPayments.brand, valueCents: net }).from(comandaPayments).innerJoin(comandas, eq(comandas.id, comandaPayments.comandaId))
    .where(and(live, sql`${comandaPayments.method} in ('credito', 'debito')`)).groupBy(comandaPayments.method, comandaPayments.brand).orderBy(comandaPayments.method, comandaPayments.brand);
  const moves = await q.select({ kind: cashMovements.kind, v: sql<number>`sum(${cashMovements.valueCents})::int` }).from(cashMovements)
    .where(and(eq(cashMovements.cashSessionId, sessionId), isNull(cashMovements.cancelledAt))).groupBy(cashMovements.kind);
  const [open] = await q.select({ n: sql<number>`count(*)::int` }).from(comandas).where(and(eq(comandas.status, "aberta"), notEmptySql(sql`${comandas.id}`)));
  const rec = received.map((r) => ({ method: r.method as PayMethod, valueCents: r.valueCents }));
  const suprimentosCents = moves.find((m) => m.kind === "suprimento")?.v ?? 0, sangriasCents = moves.find((m) => m.kind === "sangria")?.v ?? 0;
  const session = row.s;
  return {
    session, ownerName: row.owner, openingCents: session.openingCents, received: rec, suprimentosCents, sangriasCents, openComandas: open?.n ?? 0,
    byBrand: brands.filter((b) => isCardMethod(b.method)).map((b) => ({ method: b.method as "credito" | "debito", brand: b.brand ?? "", valueCents: b.valueCents })),
    expected: expectedByMethod({ openingCents: session.openingCents, received: rec, suprimentosCents, sangriasCents }),
  };
}

/**
 * Confere, ANTES de gravar, que a sangria pode virar vale: recursos ligados, `caixa.vale`, profissional com acesso ao app e a senha DELA
 * (limite de tentativas vem de Configurações › Caixa, por quem opera). Devolve a profissional.
 */
async function checkVale(vale: { professionalId: string; password: string }, actor: Actor): Promise<{ id: string; name: string }> {
  await assertRecurso("valePelaSangria");
  await assertRecurso("vales");
  if (!can(actor.perms, "caixa.vale")) throw new UserFacingError("Você não tem permissão para isso.");
  const [p] = await db.select({ id: professionals.id, name: professionals.name, userId: professionals.userId }).from(professionals).where(eq(professionals.id, vale.professionalId));
  if (!p) throw new UserFacingError("Profissional não encontrada.");
  const [u] = p.userId ? await db.select({ email: users.email, active: users.active }).from(users).where(eq(users.id, p.userId)) : [];
  if (!p.userId || !u?.active) throw new UserFacingError(`${firstName(p.name) ?? p.name} ainda não tem acesso ao app. Cadastre em Configurações › Profissionais.`);
  const r = await getCaixaRecursos();
  const limitKey = `vale-senha:${actor.id}:${p.id}`; // por quem opera E pela profissional: acertar a de uma não zera os erros contra outra
  if (!allow(limitKey, r.valeSenhaTentativas, r.valeSenhaJanelaMin * 60_000)) throw new UserFacingError("Muitas tentativas. Espere alguns minutos.");
  const ok = typeof vale.password === "string" && vale.password !== "" && (await checkCredentials(u.email, vale.password))?.id === p.userId;
  if (!ok) throw new UserFacingError(`A senha de ${firstName(p.name) ?? p.name} não confere.`);
  resetLimit(limitKey); // só a tentativa errada conta
  return { id: p.id, name: p.name };
}

/**
 * Sangria (tira dinheiro) ou suprimento (põe), com motivo, no caixa da própria pessoa. Sangria grande vai também para a auditoria.
 * Sangria com `vale`: confere a senha da profissional e cria o vale ligado à sangria (cancelar a sangria cancela o vale).
 */
export async function addMovement(input: { kind: "sangria" | "suprimento"; valueCents: number; reason: string; vale?: { professionalId: string; password: string } | null }, actor: Actor, now = new Date()): Promise<{ id: string }> {
  if (!Number.isInteger(input.valueCents) || input.valueCents <= 0) throw new UserFacingError("Digite um valor maior que zero.");
  if (!input.reason?.trim()) throw new UserFacingError("Escreva o motivo.");
  if (input.vale && input.kind !== "sangria") throw new UserFacingError("Só a sangria vira vale.");
  const pro = input.vale ? await checkVale(input.vale, actor) : null;
  return db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    await lockKeyTx(tx, cashLock(actor.id));
    const open = await getOpenCashTx(tx, actor.id);
    if (!open) throw new UserFacingError("Abra o seu caixa primeiro.");
    const rules = await getCaixaRules(tx);
    if (input.kind === "sangria") {
      const cash = (await cashSummary(open.id, tx)).expected.dinheiro;
      // Na contagem cega, o valor do caixa não aparece (senão a sangria vira um jeito de saber o esperado).
      if (input.valueCents > cash) throw new UserFacingError(isBlindFor(rules, actor) ? "Sangria maior que o dinheiro do caixa." : `No caixa há ${money(cash)} em dinheiro.`);
    }
    const reason = input.reason.trim();
    const [m] = await tx.insert(cashMovements).values({ cashSessionId: open.id, kind: input.kind, valueCents: input.valueCents, reason, createdBy: actor.id, createdAt: now }).returning({ id: cashMovements.id });
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: `caixa_${input.kind}`, entity: "cash_session", entityId: open.id, data: { valor: input.valueCents, motivo: reason } });
    if (input.kind === "sangria" && input.valueCents >= rules.sangriaGrandeCents) {
      await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "caixa_sangria_grande", entity: "cash_session", entityId: open.id, data: { valor: input.valueCents, motivo: reason, movimento: m.id } });
    }
    if (pro) {
      const [a] = await tx.insert(professionalAdjustments).values({ professionalId: pro.id, kind: "vale", valueCents: input.valueCents, day: todayBahia(now), note: reason, cashMovementId: m.id, createdBy: actor.id, createdAt: now })
        .returning({ id: professionalAdjustments.id });
      await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "vale_pela_sangria", entity: "professional_adjustment", entityId: a.id,
        data: { antes: null, depois: { profissional: pro.name, kind: "vale", valueCents: input.valueCents }, motivo: reason, movimento: m.id, caixa: open.id } });
    }
    return m;
  });
}

/**
 * Cancelar uma sangria ou suprimento do próprio caixa aberto (a gestão cancela de qualquer um). O vale que veio da sangria é cancelado junto;
 * se ele já entrou num pagamento da comissão, não deixa.
 */
export async function cancelMovement(id: string, input: { reason: string }, actor: Actor, now = new Date()): Promise<void> {
  const reason = (input?.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new UserFacingError("Escreva o motivo.");
  await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const [row] = await tx.select({ m: cashMovements, s: cashSessions }).from(cashMovements).innerJoin(cashSessions, eq(cashSessions.id, cashMovements.cashSessionId)).where(eq(cashMovements.id, id));
    if (!row) throw new UserFacingError("Movimento não encontrado.");
    if (row.s.openedBy !== actor.id && !can(actor.perms, "caixa.gerir")) throw new UserFacingError("Só a gestão cancela o movimento do caixa de outra pessoa.");
    await lockKeyTx(tx, cashLock(row.s.openedBy));
    const [m] = await tx.select().from(cashMovements).where(eq(cashMovements.id, id)).for("update");
    if (m.cancelledAt) return;
    const [s] = await tx.select({ status: cashSessions.status }).from(cashSessions).where(eq(cashSessions.id, m.cashSessionId));
    if (s.status !== "aberto") throw new UserFacingError("Esse caixa já foi fechado. Reabra o caixa antes.");
    const [adj] = await tx.select().from(professionalAdjustments).where(and(eq(professionalAdjustments.cashMovementId, id), isNull(professionalAdjustments.cancelledAt))).for("update");
    if (adj?.payoutId) throw new UserFacingError("O vale dessa sangria já entrou num pagamento. Desfaça o pagamento em Comissão antes.");
    await tx.update(cashMovements).set({ cancelledAt: now, cancelledBy: actor.id }).where(eq(cashMovements.id, id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: `caixa_${m.kind}_cancelada`, entity: "cash_session", entityId: m.cashSessionId,
      data: { antes: { valor: m.valueCents, motivo: m.reason }, depois: null, motivo: reason, movimento: id } });
    if (adj) await cancelTx(tx, adj.id, `Sangria cancelada: ${reason}`, actor.id, now);
  });
}

export type CloseCashInput = {
  /** Sem sessão: o caixa da própria pessoa. Com sessão de outra pessoa: só a gestão. */
  sessionId?: string | null;
  /** Dinheiro por cédula e moeda (centavos da cédula → quantidade). */
  cashBreakdown: Record<string, number>;
  /** As outras formas pelo total; o que não vier vale zero. */
  counted: Partial<Record<Exclude<DrawerMethod, "dinheiro">, number | null>>;
  notes?: string | null;
  /** Quem da gestão aprovou a diferença acima da tolerância (conferido pelo perfil). */
  approverId?: string | null;
};
export type CloseCashResult =
  /** `differences`: contado − esperado por forma (null na contagem cega, para quem não é gestão). */
  | { status: "precisa_aprovacao"; differenceCents: number | null; differences: Record<DrawerMethod, number> | null }
  | { status: "fechado"; differenceCents: number; differences: Record<DrawerMethod, number>; expected: Record<DrawerMethod, number>; counted: Record<DrawerMethod, number>; openComandas: number; warning: string | null };

/**
 * Fechar o caixa (Norte Vendas): o esperado de cada forma ao lado do contado (dinheiro pelas cédulas) e a diferença. Acima da tolerância,
 * só fecha com a aprovação de quem tem `caixa.gerir`; na contagem cega, quem não é gestão não fica sabendo a diferença antes de fechar.
 */
export async function closeCash(input: CloseCashInput, actor: Actor, now = new Date()): Promise<CloseCashResult> {
  const breakdown = Object.fromEntries(Object.entries(input.cashBreakdown ?? {}).filter(([, v]) => Number.isInteger(v) && v > 0));
  const others = Object.fromEntries((["pix", "credito", "debito", "outra"] as const).map((m) => [m, input.counted?.[m] ?? 0]));
  if (Object.values(others).some((v) => !Number.isInteger(v) || v < 0)) throw new UserFacingError("Confira os valores contados.");
  const counted = { dinheiro: sumDenominations(breakdown), ...others } as Record<DrawerMethod, number>;
  const gerir = can(actor.perms, "caixa.gerir");
  const r = await db.transaction(async (tx): Promise<CloseCashResult> => {
    await assertCaixaOn(tx);
    const [target] = input.sessionId ? await tx.select().from(cashSessions).where(eq(cashSessions.id, input.sessionId)) : [await getOpenCashTx(tx, actor.id)];
    if (!target) throw new UserFacingError(input.sessionId ? "Caixa não encontrado." : "Seu caixa não está aberto.");
    if (target.openedBy !== actor.id && !gerir) throw new UserFacingError("Só a gestão fecha o caixa de outra pessoa.");
    await lockKeyTx(tx, cashLock(target.openedBy));
    const [open] = await tx.select().from(cashSessions).where(eq(cashSessions.id, target.id)).for("update");
    if (open.status !== "aberto") throw new UserFacingError("Esse caixa já foi fechado.");
    await assertNoPendingChangeTx(tx, open.id);
    const rules = await getCaixaRules(tx);
    const sum = await cashSummary(open.id, tx);
    const diff = cashDifference(sum.expected, counted);
    const differences = diff.byMethod as Record<DrawerMethod, number>;
    const notes = input.notes?.trim() || null;
    const approved = input.approverId ? await userHasPerm(input.approverId, "caixa.gerir", tx) : false;
    // Recontar depois de um "precisa de aprovação" não dispensa a gestão: a primeira contagem fica na auditoria.
    const [refused] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, "caixa_contagem_recusada"), eq(auditLog.entityId, open.id))).limit(1);
    // Forma por forma (QA r58, C-1): a soma de uma falta com uma sobra nunca esconde a diferença.
    const mustApprove = needsApprovalByMethod(differences, rules.toleranciaCents) || !!refused;
    if (mustApprove && !approved) {
      await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "caixa_contagem_recusada", entity: "cash_session", entityId: open.id,
        data: { dono: open.openedBy, contado: counted, cedulas: breakdown, diferenca: diff.totalCents, diferencas: differences, esperado: sum.expected, motivo: notes, recontagem: !!refused } });
      const hide = isBlindFor(rules, actor);
      return { status: "precisa_aprovacao", differenceCents: hide ? null : diff.totalCents, differences: hide ? null : differences };
    }
    const approvedBy = approved && mustApprove ? input.approverId! : null;
    await tx.update(cashSessions).set({
      status: "fechado", closedBy: actor.id, closedAt: now, expected: sum.expected, counted, countedBreakdown: breakdown, differenceCents: diff.totalCents,
      blind: isBlindFor(rules, actor), approvedBy, approvedAt: approvedBy ? now : null, notes: notes || open.notes,
    }).where(eq(cashSessions.id, open.id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "caixa_fechado", entity: "cash_session", entityId: open.id,
      data: { dono: open.openedBy, esperado: sum.expected, contado: counted, cedulas: breakdown, diferenca: diff.totalCents, diferencas: differences, aprovadoPor: approvedBy, motivo: notes } });
    const n = sum.openComandas;
    return { status: "fechado", differenceCents: diff.totalCents, differences, expected: sum.expected, counted, openComandas: n,
      warning: n ? `${n} ${n === 1 ? "comanda aberta fica" : "comandas abertas ficam"} para o próximo caixa.` : null };
  });
  return r;
}

/** Comanda aberta com dinheiro deste caixa que já passou do total: o troco ainda não foi registrado (só no Finalizar). Fechar agora erraria o esperado. */
async function assertNoPendingChangeTx(tx: Tx, sessionId: string): Promise<void> {
  const open = await tx.selectDistinct({ id: comandas.id, number: comandas.number, discountCents: comandas.discountCents }).from(comandas)
    .innerJoin(comandaPayments, eq(comandaPayments.comandaId, comandas.id))
    .where(and(eq(comandas.status, "aberta"), eq(comandaPayments.cashSessionId, sessionId), eq(comandaPayments.method, "dinheiro"), isNull(comandaPayments.cancelledAt)));
  for (const c of open) {
    const items = await tx.select().from(comandaItems).where(and(eq(comandaItems.comandaId, c.id), isNull(comandaItems.cancelledAt)));
    const pays = await tx.select().from(comandaPayments).where(and(eq(comandaPayments.comandaId, c.id), isNull(comandaPayments.cancelledAt)));
    const total = comandaTotals(items.map((i) => ({ id: i.id, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, kind: i.kind })), c.discountCents).totalCents;
    if (changeFor(pays, total) > 0) throw new UserFacingError(`A comanda ${c.number} tem troco a devolver: finalize antes de fechar o caixa.`);
  }
}

/**
 * Reabrir um caixa fechado (gestão, `caixa.gerir` na ação): só se a dona não tiver outro aberto. Pede o motivo (QA r58, I-2), que vai
 * para a auditoria com quem reabriu, quando tinha fechado e a diferença de antes.
 */
export async function reopenCash(id: string, input: { reason: string }, actor: Actor, now = new Date()): Promise<void> {
  const reason = (input?.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new UserFacingError("Escreva o motivo da reabertura.");
  await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const [s] = await tx.select({ s: cashSessions, owner: teamNameOf(cashSessions.openedBy) }).from(cashSessions).where(eq(cashSessions.id, id));
    if (!s) throw new UserFacingError("Caixa não encontrado.");
    await lockKeyTx(tx, cashLock(s.s.openedBy));
    if (s.s.status === "aberto") return;
    if (await getOpenCashTx(tx, s.s.openedBy)) throw new UserFacingError(`${firstName(s.owner) ?? "A dona do caixa"} já tem um caixa aberto.`);
    await tx.update(cashSessions).set({ status: "aberto", reopenedBy: actor.id, reopenedAt: now }).where(eq(cashSessions.id, id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "caixa_reaberto", entity: "cash_session", entityId: id,
      data: { dono: s.s.openedBy, motivo: reason, fechadoEm: s.s.closedAt?.toISOString() ?? null, diferencaAnterior: s.s.differenceCents } });
  });
}

export type MovementRow = { id: string; kind: "sangria" | "suprimento"; valueCents: number; reason: string; at: string; vale: string | null };

/** Sangrias e suprimentos vivos de um caixa (com a profissional, quando a sangria virou vale). */
export async function listMovements(sessionId: string, q: Q = db): Promise<MovementRow[]> {
  const rows = await q.select({ m: cashMovements, pro: professionals.name }).from(cashMovements)
    .leftJoin(professionalAdjustments, and(eq(professionalAdjustments.cashMovementId, cashMovements.id), isNull(professionalAdjustments.cancelledAt)))
    .leftJoin(professionals, eq(professionals.id, professionalAdjustments.professionalId))
    .where(and(eq(cashMovements.cashSessionId, sessionId), isNull(cashMovements.cancelledAt))).orderBy(cashMovements.createdAt);
  return rows.map(({ m, pro }) => ({ id: m.id, kind: m.kind as "sangria" | "suprimento", valueCents: m.valueCents, reason: m.reason, at: m.createdAt.toISOString(), vale: pro }));
}
