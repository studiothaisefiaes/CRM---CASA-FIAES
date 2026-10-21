import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { auditLog, comandaItems, comandaPayments, comandas, contacts, lists, loyaltyEntries, loyaltyPrograms } from "../db/schema";
import { comandaTotals, courtesyShares, itemGross, itemTotal } from "@/lib/comanda-math";
import { todayBahia } from "@/lib/agenda";
import { firstName } from "@/lib/authorship";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { faltamParaPremio } from "@/lib/loyalty";
import type { Actor } from "./agenda/actor";
import { lockKeyTx } from "./agenda/locks";
import { UserFacingError } from "./errors";
import { assertFuncao, isFuncaoOn } from "./funcoes";
import { assertCaixaOn } from "./caixa/mode";
import { addItemTx, afterCaixaChange, assertOpen, lockComandaTx, toMath } from "./caixa/comandas";

/**
 * Fidelidade (item 22). Os pontos são um extrato (`loyalty_entries`): o saldo é a soma. Fechar a comanda pontua (`accrueLoyaltyTx`),
 * reabrir, cancelar, descartar e tirar o item desfazem (`reverseLoyaltyTx`), tudo dentro da transação da própria comanda.
 */
type Q = Tx | typeof db;
type Program = typeof loyaltyPrograms.$inferSelect;

export type LoyaltyStatus = { programId: string; name: string; kind: "contagem" | "aniversario"; goal: number | null; balance: number; ready: boolean; rewardServiceIds: string[] };

/** "Faltam N serviços para o prêmio." (mensagem fixa, não configurável; mora em lib/loyalty para a tela usar também). */
export { faltamParaPremio };
/** O motivo do desconto do prêmio, pelo modelo do programa ({programa} = o nome). */
export const rewardReasonOf = (p: Pick<Program, "name" | "rewardReasonTemplate">) => p.rewardReasonTemplate.replaceAll("{programa}", p.name).trim().slice(0, 300) || p.name;

/** Ano e mês em Salvador. */
function bahiaYm(now: Date): { year: number; month: number } {
  const d = todayBahia(now);
  return { year: Number(d.slice(0, 4)), month: Number(d.slice(5, 7)) };
}

async function balancesTx(q: Q, contactId: string): Promise<Map<string, number>> {
  const rows = await q.select({ programId: loyaltyEntries.programId, balance: sql<number>`coalesce(sum(${loyaltyEntries.delta}), 0)::int` })
    .from(loyaltyEntries).where(eq(loyaltyEntries.contactId, contactId)).groupBy(loyaltyEntries.programId);
  return new Map(rows.map((r) => [r.programId, Number(r.balance)]));
}

/** Programas de aniversário em que a cliente já usou o prêmio no ano (de Salvador). */
async function birthdayUsedTx(q: Q, contactId: string, year: number): Promise<Set<string>> {
  const rows = await q.selectDistinct({ programId: loyaltyEntries.programId }).from(loyaltyEntries)
    .where(and(eq(loyaltyEntries.contactId, contactId), eq(loyaltyEntries.reason, "resgate"), sql`extract(year from ${loyaltyEntries.createdAt} at time zone 'America/Bahia')::int = ${year}`));
  return new Set(rows.map((r) => r.programId));
}

/**
 * Situação da cliente em cada programa ativo. Contagem: `balance` = pontos e `ready` = chegou à meta. Aniversário: `ready` = é o mês
 * do aniversário e o prêmio não foi usado no ano; `balance` = 1 quando pronto (o prêmio disponível), senão 0.
 */
export async function loyaltyOf(contactId: string, now: Date, q: Q = db): Promise<LoyaltyStatus[]> {
  if (!isUuid(contactId)) return [];
  const progs = await q.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.active, true)).orderBy(asc(loyaltyPrograms.position), asc(loyaltyPrograms.name));
  if (!progs.length) return [];
  const balances = await balancesTx(q, contactId);
  const [ct] = await q.select({ birthMonth: contacts.birthMonth }).from(contacts).where(eq(contacts.id, contactId));
  const { year, month } = bahiaYm(now);
  const used = progs.some((p) => p.kind === "aniversario") ? await birthdayUsedTx(q, contactId, year) : new Set<string>();
  return progs.map((p) => {
    const base = { programId: p.id, name: p.name, kind: p.kind, goal: p.kind === "contagem" ? p.goal : null, rewardServiceIds: p.rewardServiceIds };
    if (p.kind === "aniversario") {
      const ready = ct?.birthMonth === month && !used.has(p.id);
      return { ...base, balance: ready ? 1 : 0, ready };
    }
    const balance = balances.get(p.id) ?? 0;
    return { ...base, balance, ready: p.goal != null && balance >= p.goal };
  });
}

/** Itens da comanda que são prêmio da fidelidade (têm a linha de resgate), com o desconto do prêmio (`reward_discount_bp`). */
export async function rewardItemsTx(q: Q, comandaId: string): Promise<Map<string, number>> {
  const rows = await q.select({ id: loyaltyEntries.comandaItemId, bp: loyaltyPrograms.rewardDiscountBp }).from(loyaltyEntries)
    .innerJoin(loyaltyPrograms, eq(loyaltyPrograms.id, loyaltyEntries.programId))
    .where(and(eq(loyaltyEntries.comandaId, comandaId), eq(loyaltyEntries.reason, "resgate"), isNotNull(loyaltyEntries.comandaItemId)));
  return new Map(rows.map((r) => [r.id!, r.bp]));
}
export const rewardItemIdsTx = async (q: Q, comandaId: string): Promise<Set<string>> => new Set((await rewardItemsTx(q, comandaId)).keys());
/** A parte do prêmio no desconto do item: uma unidade × `reward_discount_bp` (nunca mais que o desconto do item). */
export const rewardPartCents = (i: { unitCents: number | null; discountCents: number }, bp: number) =>
  i.unitCents == null ? 0 : Math.min(i.discountCents, Math.round((i.unitCents * bp) / 10000));

/**
 * Ao fechar a comanda: um ponto por unidade de cada item que conta, em cada programa de contagem ativo. Conta o serviço (a sessão de
 * pacote só se o programa ligar `counts_package_sessions`) que não é prêmio, da lista do programa (ou todos), com desconto até
 * `max_discount_bp` do valor de tabela do item (`originalUnitCents`; vazio ou 0, o preço). O desconto efetivo soma o preço baixado, o desconto do
 * item, a parte dele no desconto da comanda e a parte dele na cortesia (toda em cortesia = 100%). Item sem valor de tabela não pontua,
 * menos a sessão de pacote (já paga no pacote). Comanda sem cliente ou função desligada: nada.
 * Fechar de novo não duplica (uma linha por item, programa e motivo). Devolve quantos pontos deu.
 */
export async function accrueLoyaltyTx(tx: Tx, comandaId: string, actorId: string, now: Date): Promise<number> {
  if (!(await isFuncaoOn("fidelidade", tx))) return 0;
  const [c] = await tx.select().from(comandas).where(eq(comandas.id, comandaId));
  if (!c?.contactId) return 0;
  const progs = await tx.select().from(loyaltyPrograms).where(and(eq(loyaltyPrograms.active, true), eq(loyaltyPrograms.kind, "contagem")));
  if (!progs.length) return 0;
  const items = await tx.select().from(comandaItems).where(and(eq(comandaItems.comandaId, c.id), isNull(comandaItems.cancelledAt)));
  const rewards = await rewardItemIdsTx(tx, c.id);
  const { shares } = comandaTotals(items.map(toMath), c.discountCents);
  const courtesyCents = (await tx.select({ v: comandaPayments.valueCents }).from(comandaPayments)
    .where(and(eq(comandaPayments.comandaId, c.id), eq(comandaPayments.method, "cortesia"), isNull(comandaPayments.cancelledAt)))).reduce((a, p) => a + p.v, 0);
  const courtesy = courtesyShares(items.map((i) => ({ id: i.id, total: (itemTotal(toMath(i)) ?? 0) - (shares.get(i.id) ?? 0) })), courtesyCents);
  const rows: (typeof loyaltyEntries.$inferInsert)[] = [];
  for (const p of progs) {
    for (const it of items) {
      if (rewards.has(it.id)) continue;
      if (!(it.kind === "servico" || (it.kind === "pacote_sessao" && p.countsPackageSessions))) continue;
      if (p.countsServiceIds && !(it.serviceId && p.countsServiceIds.includes(it.serviceId))) continue;
      const points = Math.floor(Number(it.qty));
      if (points <= 0) continue;
      if (p.maxDiscountBp != null && it.kind !== "pacote_sessao") {
        // 0 é "sem tabela" (horário do Avec com R$ 0,00, serviço de preço 0): vale o preço cobrado.
        const table = itemGross({ qty: Number(it.qty), unitCents: it.originalUnitCents || it.unitCents }) ?? 0;
        const charged = (itemTotal(toMath(it)) ?? 0) - (shares.get(it.id) ?? 0) - (courtesy.get(it.id) ?? 0);
        if (table <= 0 || (table - charged) * 10000 > p.maxDiscountBp * table) continue;
      }
      rows.push({ contactId: c.contactId, programId: p.id, delta: points, reason: "servico", comandaId: c.id, comandaItemId: it.id, createdBy: actorId, createdAt: now });
    }
  }
  if (!rows.length) return 0;
  const added = await tx.insert(loyaltyEntries).values(rows).onConflictDoNothing().returning({ programId: loyaltyEntries.programId, delta: loyaltyEntries.delta });
  const total = added.reduce((a, r) => a + r.delta, 0);
  if (total) {
    const byName = Object.fromEntries(progs.map((p) => [p.name, added.filter((r) => r.programId === p.id).reduce((a, r) => a + r.delta, 0)]).filter(([, n]) => n));
    await tx.insert(auditLog).values({ userId: actorId, createdAt: now, action: "fidelidade_pontuada", entity: "comanda", entityId: c.id, data: { numero: c.number, contactId: c.contactId, pontos: byName } });
  }
  return total;
}

/**
 * Desfaz a fidelidade da comanda: apaga as linhas `servico` e `resgate` dela (ou só os `reasons` pedidos, ou só as do item) e audita
 * `fidelidade_estornada`. Vale com a função desligada: o ponto não fica órfão.
 */
export async function reverseLoyaltyTx(tx: Tx, comandaId: string, opts: { reasons?: ("servico" | "resgate")[]; itemId?: string; actorId?: string | null; now?: Date } = {}): Promise<void> {
  const gone = await tx.delete(loyaltyEntries).where(and(
    eq(loyaltyEntries.comandaId, comandaId), inArray(loyaltyEntries.reason, opts.reasons ?? ["servico", "resgate"]),
    opts.itemId ? eq(loyaltyEntries.comandaItemId, opts.itemId) : undefined,
  )).returning();
  if (!gone.length) return;
  await tx.insert(auditLog).values({ userId: opts.actorId ?? null, createdAt: opts.now ?? new Date(), action: "fidelidade_estornada", entity: "comanda", entityId: comandaId,
    data: { itemId: opts.itemId ?? null, linhas: gone.map((g) => ({ contactId: g.contactId, programId: g.programId, motivo: g.reason, delta: g.delta, itemId: g.comandaItemId })) } });
}

/**
 * "Reabrir para corrigir": as linhas (`reasons`) vão junto para o item copiado na comanda nova (`itemMap`: item antigo → novo). O prêmio
 * sempre vai; os pontos `servico` só com a função desligada (ligada, saem e voltam ao fechar a nova).
 */
export async function moveLoyaltyEntriesTx(tx: Tx, fromComandaId: string, toComandaId: string, itemMap: Map<string, string>, reasons: ("servico" | "resgate")[]): Promise<void> {
  if (!reasons.length) return;
  const rows = await tx.select().from(loyaltyEntries).where(and(eq(loyaltyEntries.comandaId, fromComandaId), inArray(loyaltyEntries.reason, reasons)));
  for (const r of rows) {
    const to = r.comandaItemId ? itemMap.get(r.comandaItemId) : undefined;
    if (!to) { await tx.delete(loyaltyEntries).where(eq(loyaltyEntries.id, r.id)); continue; }
    await tx.update(loyaltyEntries).set({ comandaId: toComandaId, comandaItemId: to }).where(eq(loyaltyEntries.id, r.id));
    if (r.reason === "resgate" && r.note) await tx.update(comandaItems).set({ discountReason: r.note }).where(eq(comandaItems.id, to)); // o motivo do prêmio vai junto
  }
}

/**
 * Usar o prêmio na comanda aberta (quem tem `fidelidade.resgatar`). Contagem: precisa de `goal` pontos; grava −goal. Aniversário: só no
 * mês do aniversário e uma vez por ano; grava −1, que marca o ano. O alvo é um serviço do prêmio, que entra na comanda com o desconto
 * (`serviceId`), ou um item que já está nela (`itemId`). O desconto (`reward_discount_bp` de uma unidade) não pede a aprovação da gestão
 * e o motivo vem do modelo do programa. Tirar o item, descartar ou cancelar a comanda devolve.
 */
export async function redeemLoyalty(
  comandaId: string, programId: string, target: { serviceId: string; professionalId: string } | { itemId: string }, actor: Actor, now = new Date(),
): Promise<{ itemId: string }> {
  if (!can(actor.perms, "fidelidade.resgatar")) throw new UserFacingError("Você não tem permissão para isso.");
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    await assertFuncao("fidelidade", tx);
    const c = await lockComandaTx(tx, comandaId);
    assertOpen(c);
    if (!c.contactId) throw new UserFacingError("Escolha a cliente para usar o prêmio da fidelidade.");
    const [p] = isUuid(programId) ? await tx.select().from(loyaltyPrograms).where(and(eq(loyaltyPrograms.id, programId), eq(loyaltyPrograms.active, true))) : [];
    if (!p) throw new UserFacingError("Programa de fidelidade não encontrado.");
    await lockKeyTx(tx, `fidelidade:${c.contactId}:${p.id}`);

    let delta: number;
    if (p.kind === "contagem") {
      const goal = p.goal ?? 0;
      const balance = (await balancesTx(tx, c.contactId)).get(p.id) ?? 0;
      if (goal <= 0 || balance < goal) throw new UserFacingError(faltamParaPremio(Math.max(1, goal - balance)));
      delta = -goal;
    } else {
      const [ct] = await tx.select({ birthMonth: contacts.birthMonth }).from(contacts).where(eq(contacts.id, c.contactId));
      const { year, month } = bahiaYm(now);
      const who = firstName(c.clientName) ?? "A cliente";
      if (ct?.birthMonth == null) throw new UserFacingError(`A ficha de ${who} não tem o mês do aniversário.`);
      if (ct.birthMonth !== month) throw new UserFacingError(`O prêmio de ${p.name} é só no mês do aniversário.`);
      if ((await birthdayUsedTx(tx, c.contactId, year)).has(p.id)) throw new UserFacingError(`${who} já usou o prêmio de ${p.name} este ano.`);
      delta = -1;
    }

    const reason = rewardReasonOf(p);
    let itemId: string;
    if ("itemId" in target) {
      const [it] = isUuid(target.itemId) ? await tx.select().from(comandaItems).where(eq(comandaItems.id, target.itemId)) : [];
      if (!it || it.cancelledAt || it.comandaId !== c.id) throw new UserFacingError("Item não encontrado.");
      if (it.kind !== "servico" || !it.serviceId || !p.rewardServiceIds.includes(it.serviceId)) throw new UserFacingError(`${it.label} não é prêmio do ${p.name}.`);
      if ((await rewardItemIdsTx(tx, c.id)).has(it.id)) throw new UserFacingError("Esse item já é prêmio da fidelidade.");
      if (it.unitCents == null) throw new UserFacingError(`Falta o preço de ${it.label}.`);
      if (it.discountCents > 0) throw new UserFacingError("Esse item já tem desconto. Tire o desconto antes de usar o prêmio.");
      const discountCents = Math.min(itemGross({ qty: Number(it.qty), unitCents: it.unitCents }) ?? 0, Math.round((it.unitCents * p.rewardDiscountBp) / 10000));
      await tx.update(comandaItems).set({ discountCents, discountReason: reason }).where(eq(comandaItems.id, it.id));
      await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "desconto", entity: "comanda", entityId: c.id,
        data: { numero: c.number, itemId: it.id, item: it.label, valor: discountCents, percentual: p.rewardDiscountBp / 100, motivo: reason } });
      await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
      itemId = it.id;
    } else {
      const [svc] = isUuid(target.serviceId) ? await tx.select({ id: lists.id, label: lists.label }).from(lists).where(and(eq(lists.id, target.serviceId), eq(lists.kind, "service"))) : [];
      if (!svc) throw new UserFacingError("Escolha o serviço.");
      if (!p.rewardServiceIds.includes(svc.id)) throw new UserFacingError(`${svc.label} não é prêmio do ${p.name}.`);
      itemId = (await addItemTx(tx, c, { kind: "servico", serviceId: svc.id, professionalId: target.professionalId, discountPercent: p.rewardDiscountBp / 100, reason, ruleDiscount: "fidelidade" }, actor, now)).id;
      const [it] = await tx.select({ unitCents: comandaItems.unitCents }).from(comandaItems).where(eq(comandaItems.id, itemId));
      if (it?.unitCents == null) throw new UserFacingError(`Falta o preço de ${svc.label}.`);
    }

    await tx.insert(loyaltyEntries).values({ contactId: c.contactId, programId: p.id, delta, reason: "resgate", comandaId: c.id, comandaItemId: itemId, note: reason, createdBy: actor.id, createdAt: now });
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "fidelidade_resgate", entity: "comanda", entityId: c.id,
      data: { numero: c.number, contactId: c.contactId, programa: p.name, itemId, pontos: delta } });
    return { itemId, day: c.day };
  });
  await afterCaixaChange([r.day]);
  return { itemId: r.itemId };
}
