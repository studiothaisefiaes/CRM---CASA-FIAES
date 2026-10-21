import { genericClientSql } from "@/lib/generic-client";
import { and, asc, eq, gte, inArray, isNull, ne, notInArray, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { appointments, auditLog, cashSessions, clientCreditEntries, clientPackages, comandaItems, comandaPayments, comandas, contacts, lists, packageDefs, packageUses, paymentMethodOptions, professionalServices, professionals, products, visits, type Comanda } from "../../db/schema";
import { bpToPercent, CARD_BRANDS, checkNewPayment, checkPayments, comandaTotals, type ComandaTotals, discountFrom, feeCents, fiscalKindOf, isCardMethod, itemGross, PAY_METHODS, type PayMethod } from "@/lib/comanda-math";
import { cpfDigits, isValidCpf } from "@/lib/cpf";
import { can } from "@/lib/permissions";
import { dayOf, shiftDay, todayBahia } from "@/lib/agenda";
import { firstName } from "@/lib/authorship";
import { money } from "@/lib/format";
import { isUuid } from "@/lib/uuid";
import { teamNameOf } from "../../queries/team-name";
import { lockKeyTx } from "../agenda/locks";
import { ensureVisitFor } from "../agenda/visits";
import { afterAgendaChange } from "../agenda/notify";
import type { Actor } from "../agenda/actor";
import { emit } from "../events";
import { normText } from "../avec/normalize";
import { UserFacingError } from "../errors";
import { setAppointmentStatusTx } from "../appointments";
import { accrueLoyaltyTx, moveLoyaltyEntriesTx, reverseLoyaltyTx, rewardItemIdsTx, rewardItemsTx, rewardPartCents } from "../fidelidade";
import { isFuncaoOn } from "../funcoes";
import { serviceTermsFor } from "../service-terms";
import { assertCaixaOn, getCaixaRules } from "./mode";
import { getOpenCashTx, lockOpenCashTx, userHasPerm } from "./cash";
import { getEstoqueConfig } from "../estoque/config";
import { reverseSaleMovementsTx, saleMovementsTx } from "../estoque/baixa";
import { addCreditTx, creditBalance, lockClientCreditTx } from "./credits";
import { getFiscalEmpresa, getNfceModo, getNfseModo } from "../fiscal/config";
import { queueNfseTx } from "../fiscal/nfse";
import { queueNfceTx } from "../fiscal/nfce/nfce";
import { assertNoAuthorizedNoteTx, settleNotesBeforeReopen, type NotaDeps } from "../fiscal/portas";
import { loadFiscalCert, type FiscalCert } from "../fiscal/certificate";
import { feeBpTx } from "./payment-fees";
import { getCaixaRecursos } from "./recursos";
import { assistantNamesTx, copyAssistantsTx, fillFromAppointmentTx, fillSuggestedAssistantsTx } from "./assistants";
import { clearCommissionSnapshotTx, snapshotCommissionsTx } from "./commission-snapshot";
import { assertCommissionNotPaidTx } from "./payouts";
import { getCommissionRules } from "./commission-rules";
import { assertSettledCommissionNotPaidTx, comandaDebtRemaining, debtOverMessage, leaveDebtTx, settleDebtsTx, undoDebtsTx } from "./debts";
import { recursoOffMessage } from "@/lib/caixa-recursos";

/**
 * A comanda (7.1, 7.4): nasce do horário (uma aberta por visita) ou avulsa (balcão), soma itens e recebe. Fechar é a 6C.5.
 * Toda mudança trava a comanda (`FOR UPDATE`) e confere que ela ainda está aberta.
 */
/** `divida`: quita a dívida de uma comanda anterior da cliente ("Dívida da comanda N de dd/mm"); sem profissional nem comissão. */
export const ITEM_KINDS = ["servico", "produto", "pacote_venda", "pacote_sessao", "divida"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
/** Horários que entram na comanda: os que ainda vão acontecer ou já aconteceram (nunca cancelado, faltou, espera). */
export const BILLABLE_STATUSES = ["agendado", "confirmado", "chegou", "em_atendimento", "compareceu"] as const;
const BALCAO = "Cliente de balcão";
const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const dm = (day: string) => DM.format(new Date(`${day}T12:00:00Z`));

export async function lockComandaTx(tx: Tx, id: string): Promise<Comanda> {
  const [c] = isUuid(id) ? await tx.select().from(comandas).where(eq(comandas.id, id)).for("update") : [];
  if (!c) throw new UserFacingError("Comanda não encontrada.");
  return c;
}
export function assertOpen(c: Comanda) {
  if (c.status === "fechada") throw new UserFacingError("Essa comanda já foi fechada.");
  if (c.status === "cancelada") throw new UserFacingError("Essa comanda foi cancelada.");
}

/** Número do dia ("Comanda 12 de 16/10"), com trava por dia. */
export async function nextComandaNumberTx(tx: Tx, day: string): Promise<number> {
  await lockKeyTx(tx, `comanda:numero:${day}`);
  const [r] = await tx.select({ n: sql<number>`coalesce(max(${comandas.number}), 0)::int` }).from(comandas).where(eq(comandas.day, day));
  return (r?.n ?? 0) + 1;
}

export async function afterCaixaChange(days: Iterable<string>): Promise<void> {
  const list = [...new Set(days)];
  await afterAgendaChange(list); // selo R$ e "falta fechar" na Agenda
  for (const day of list) await emit("caixa_alterado", { day });
}

/** Itens de serviço dos horários (que ainda não estão numa comanda viva). `warnings` recebe o aviso das auxiliares que não couberam. */
async function addAppointmentItemsTx(tx: Tx, comandaId: string, where: SQL | undefined, actorId: string, now: Date, warnings: string[] = []): Promise<number> {
  const billed = tx.select({ id: comandaItems.appointmentId }).from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .where(and(isNull(comandaItems.cancelledAt), sql`${comandaItems.appointmentId} is not null`, notInArray(comandas.status, ["cancelada"])));
  const proOn = await isFuncaoOn("preco_por_profissional", tx);
  const rows = await tx.select({ id: appointments.id, label: appointments.serviceLabel, serviceId: appointments.serviceId, pro: appointments.professionalId, price: appointments.priceCents, servicePrice: lists.priceCents, proPrice: professionalServices.priceCents })
    .from(appointments).leftJoin(lists, eq(lists.id, appointments.serviceId))
    .leftJoin(professionalServices, and(eq(professionalServices.serviceId, appointments.serviceId), eq(professionalServices.professionalId, appointments.professionalId)))
    .where(and(where, inArray(appointments.status, [...BILLABLE_STATUSES]), isNull(appointments.avecTwinOf), sql`${appointments.id} not in (${billed})`, sql`not ${genericClientSql(appointments)}`))
    .orderBy(asc(appointments.startsAt));
  // Preço do horário; sem ele, o da profissional (0084) e então o do serviço.
  const priceOf = (r: (typeof rows)[number]) => r.price ?? (proOn ? r.proPrice : null) ?? r.servicePrice ?? null;
  // createdAt = o "agora" da ação (como em addItem), + 1 ms por horário: a ordem dos itens segue a dos horários.
  if (rows.length) {
    const created = await tx.insert(comandaItems).values(rows.map((r, k) => ({
      comandaId, kind: "servico", label: r.label, serviceId: r.serviceId, appointmentId: r.id, professionalId: r.pro, qty: 1, unitCents: priceOf(r), addedBy: actorId,
      originalUnitCents: priceOf(r), fiscalKind: "servico",
      createdAt: new Date(now.getTime() + k),
    }))).returning({ id: comandaItems.id, pro: comandaItems.professionalId, appointmentId: comandaItems.appointmentId, label: comandaItems.label });
    // O serviço nasce com as auxiliares do horário (0089) ou, sem elas, com as assistentes da profissional (sem auditoria: ninguém trocou nada).
    for (const it of created) {
      const w = await fillFromAppointmentTx(tx, it.id, it.appointmentId, it.pro, actorId);
      if (w) {
        warnings.push(`${it.label}: ${w}`);
        await tx.insert(auditLog).values({ userId: actorId, createdAt: now, action: "assistente_de_fora", entity: "comanda", entityId: comandaId, data: { itemId: it.id, item: it.label, aviso: w } });
      }
    }
  }
  return rows.length;
}

/** "Abrir comanda" no card do horário ou na faixa Agora: reaproveita a aberta da visita. */
export async function openComandaForAppointment(appointmentId: string, actor: Actor, now = new Date()): Promise<{ comandaId: string; number: number; created: boolean; warnings?: string[] }> {
  const warnings: string[] = [];
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    // A CLIENTE PADRÃO do Avec não é uma cliente: venda dela é de balcão (17/10).
    const [g] = await tx.select({ generic: genericClientSql(appointments) }).from(appointments).where(eq(appointments.id, appointmentId));
    if (g?.generic) throw new UserFacingError("Horário da CLIENTE PADRÃO do Avec: abra uma comanda avulsa pelo Caixa.");
    const visitId = await ensureVisitFor(appointmentId, tx);
    await lockKeyTx(tx, `comanda:visita:${visitId}`);
    const [v] = await tx.select().from(visits).where(eq(visits.id, visitId));
    const [open] = await tx.select().from(comandas).where(and(eq(comandas.visitId, visitId), eq(comandas.status, "aberta")));
    if (open) {
      await addAppointmentItemsTx(tx, open.id, eq(appointments.visitId, visitId), actor.id, now, warnings);
      return { comandaId: open.id, number: open.number, created: false, day: open.day };
    }
    // O dia da comanda é o do caixa (hoje), não o do horário: pagar antes um horário de outro dia fica como "pago antes" (7.9).
    const day = todayBahia(now);
    const number = await nextComandaNumberTx(tx, day);
    const [c] = await tx.insert(comandas).values({ day, number, contactId: v.contactId, clientName: v.clientName, visitId, openedBy: actor.id, openedAt: now, updatedAt: now }).returning();
    await addAppointmentItemsTx(tx, c.id, eq(appointments.visitId, visitId), actor.id, now, warnings);
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_aberta", entity: "comanda", entityId: c.id, data: { visitId, numero: number } });
    return { comandaId: c.id, number, created: true, day };
  });
  await afterCaixaChange([r.day]);
  return { comandaId: r.comandaId, number: r.number, created: r.created, ...(warnings.length ? { warnings } : {}) };
}

/**
 * Comanda avulsa (venda sem horário), pelo Caixa. Sem cliente: "Cliente de balcão". A request key evita abrir duas. Pela tela ("Nova
 * comanda"), ela nasce com o primeiro item na mesma transação (QA r58, I-8): item recusado não deixa comanda vazia para trás.
 */
export async function openWalkInComanda(input: { contactId?: string | null; clientName?: string | null; requestKey: string; item?: AddItemInput | null }, actor: Actor, now = new Date()): Promise<{ comandaId: string; number: number }> {
  const key = z.string().uuid().parse(input.requestKey);
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    await lockKeyTx(tx, `comanda:req:${key}`);
    const [dup] = await tx.select().from(comandas).where(eq(comandas.requestKey, key));
    if (dup) return { comandaId: dup.id, number: dup.number, day: dup.day };
    let name = input.clientName?.trim() || null;
    if (input.contactId) {
      const [c] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!c) throw new UserFacingError("Cliente não encontrada.");
      name = c.name ?? name;
    }
    const day = todayBahia(now);
    const number = await nextComandaNumberTx(tx, day);
    const [c] = await tx.insert(comandas).values({ day, number, contactId: input.contactId ?? null, clientName: name ?? BALCAO, requestKey: key, openedBy: actor.id, openedAt: now, updatedAt: now }).returning();
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_aberta", entity: "comanda", entityId: c.id, data: { avulsa: true, numero: number } });
    if (input.item) await addItemTx(tx, c, { ...input.item, ruleDiscount: undefined }, actor, now);
    return { comandaId: c.id, number, day };
  });
  await afterCaixaChange([r.day]);
  return { comandaId: r.comandaId, number: r.number };
}

/** "Juntar horário de hoje": os horários da mesma cliente no dia da comanda que ainda não estão em comanda (7.4, regra 1). */
export async function joinTodayAppointments(comandaId: string, actor: Actor, now = new Date()): Promise<{ added: number }> {
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    assertOpen(c);
    if (!c.contactId) throw new UserFacingError("Escolha a cliente para juntar os horários dela.");
    const added = await addAppointmentItemsTx(tx, c.id, and(eq(appointments.contactId, c.contactId), sql`(${appointments.startsAt} at time zone 'America/Bahia')::date = ${c.day}::date`), actor.id, now);
    if (!added) throw new UserFacingError("Nenhum outro horário de hoje para juntar.");
    await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
    return { added, day: c.day };
  });
  await afterCaixaChange([r.day]);
  return { added: r.added };
}

export type AddItemInput = {
  kind: ItemKind; serviceId?: string | null; label?: string | null; professionalId?: string | null; qty?: number;
  unitCents?: number | null; discountCents?: number | null; discountPercent?: number | null; clientPackageId?: string | null; packageDefId?: string | null;
  /** Produto do catálogo (kind = produto), com Produtos e estoque ligado. */ productId?: string | null;
  /** Motivo: obrigatório quando o preço sai diferente do catálogo (ou do pacote) e quando há desconto. */ reason?: string | null;
  /** Quem da gestão aprovou o desconto acima do limite (conferido pelo perfil). */ approverId?: string | null;
  /** Desconto de regra da Casa (o prêmio da fidelidade): não pede aprovação. Só o domínio passa; `addItem` (a tela) tira. */ ruleDiscount?: "fidelidade";
  /** Item "divida": a comanda cuja dívida ele quita. */ settlesComandaId?: string | null;
};

/** Cortesia ou desconto acima do limite da Casa, sem a aprovação da gestão (QA r58, I-11): a tela oferece a aprovação, como no fechamento. */
export class ApprovalNeededError extends UserFacingError {}

/**
 * "Cortesia ou desconto acima de X% pede aprovação da gestão" (Caixas da equipe › Regras; desligado por padrão). Mede a COMANDA inteira,
 * já com a mudança gravada (a transação desfaz se faltar a aprovação): o que deixou de ser cobrado sobre o preço de tabela (preço abaixo
 * dela, desconto no item, desconto na comanda e cortesia, somados) contra o valor de tabela. Assim 19% + 19% + 19% não passam sem a
 * gestão (revisão). Devolve quem aprovou quando foi preciso, para a auditoria; a gestão também confirma a própria, com um clique.
 */
async function comandaApprovalTx(tx: Tx, comandaId: string, approverId: string | null | undefined): Promise<string | null> {
  const { aprovacaoDescontoBp: limit } = await getCaixaRules(tx);
  if (limit == null) return null;
  const [cm] = await tx.select({ discountCents: comandas.discountCents }).from(comandas).where(eq(comandas.id, comandaId));
  const items = await liveItems(tx, comandaId);
  // A dívida fica fora da conta: o limite mede só o que foi vendido. O prêmio da fidelidade é regra da Casa, não desconto dado: só a parte dele (1 unidade × o desconto do prêmio) sai da conta.
  const sales = items.filter((i) => i.kind !== "divida");
  const rewards = await rewardItemsTx(tx, comandaId);
  const rewardCents = sales.reduce((a, i) => a + (rewards.has(i.id) ? rewardPartCents(i, rewards.get(i.id)!) : 0), 0);
  const tableCents = sales.reduce((a, i) => a + Math.round(Number(i.qty) * (i.originalUnitCents ?? i.unitCents ?? 0)), 0) - rewardCents;
  const courtesy = (await livePaymentsTx(tx, comandaId)).filter((p) => p.method === "cortesia").reduce((a, p) => a + p.valueCents, 0);
  const t = comandaTotals(items.map(toMath), cm?.discountCents ?? 0);
  const offCents = tableCents - (t.discountableCents - t.discountCents - courtesy);
  if (tableCents <= 0 || offCents <= 0) return null;
  const bp = Math.round((offCents * 10000) / tableCents);
  if (bp <= limit) return null;
  if (approverId && (await userHasPerm(approverId, "caixa.gerir", tx))) return approverId;
  throw new ApprovalNeededError(`Desconto e cortesia somam ${bpToPercent(bp)}% da comanda, acima do limite de ${bpToPercent(limit)}%: a gestão aprova.`);
}
const reasonOf = (r: string | null | undefined) => r?.trim().slice(0, 300) || null;
export const PRICE_REASON = "Escreva o motivo da mudança de preço.";
export const DISCOUNT_REASON = "Escreva o motivo do desconto.";

async function serviceIdByLabel(tx: Tx, label: string | null): Promise<string | null> {
  if (!label) return null;
  const all = await tx.select({ id: lists.id, label: lists.label }).from(lists).where(eq(lists.kind, "service"));
  return all.find((s) => normText(s.label) === normText(label))?.id ?? null;
}

/** Monta o item conferindo as regras 2 a 4 da 7.4 e as do pacote (7.4, regras 7 e 9). */
async function buildItemTx(tx: Tx, c: Comanda, input: AddItemInput, ignoreItemId: string | null = null) {
  const kind = z.enum(ITEM_KINDS).parse(input.kind);
  const qty = input.qty ?? 1;
  if (!(qty > 0 && qty <= 99)) throw new UserFacingError("Quantidade de 1 a 99.");
  const base = { kind, qty, professionalId: input.professionalId ?? null, serviceId: input.serviceId ?? null, clientPackageId: null as string | null, packageDefId: null as string | null, productId: null as string | null, settlesComandaId: null as string | null };
  let label = input.label?.trim() ?? "";
  let unitCents = input.unitCents ?? null;
  /** O preço "de tabela" (catálogo ou pacote): mudar dele pede motivo. */
  let basePrice: number | null = null;
  if (kind === "servico") {
    const [svc] = input.serviceId ? await tx.select().from(lists).where(and(eq(lists.id, input.serviceId), eq(lists.kind, "service"))) : [];
    if (!svc) throw new UserFacingError("Escolha o serviço.");
    label = svc.label;
    if (!base.professionalId) throw new UserFacingError(`Escolha a profissional de ${svc.label}.`);
    // 0084: o preço de tabela é o da profissional (o próprio dela, senão o do serviço); mudar dele pede motivo e conta como desconto.
    basePrice = (await serviceTermsFor(tx, svc.id, base.professionalId)).priceCents;
    unitCents = input.unitCents !== undefined ? input.unitCents : basePrice;
  } else if (kind === "produto") {
    // Editando um item já lançado: o produto do item vale mesmo desativado depois, e item de texto livre (lançado com o estoque desligado) segue texto livre.
    const editingFree = ignoreItemId != null && !input.productId;
    if (!editingFree && (await getEstoqueConfig(tx)).ligado) {
      const [prod] = input.productId ? await tx.select().from(products).where(and(eq(products.id, input.productId), ignoreItemId ? undefined : eq(products.active, true))) : [];
      if (!prod) throw new UserFacingError("Escolha o produto (cadastre em Serviços e pacotes › Produtos).");
      label = prod.name;
      basePrice = prod.priceCents ?? null;
      unitCents = input.unitCents !== undefined ? input.unitCents : basePrice;
      base.productId = prod.id;
    } else if (!label) throw new UserFacingError("Escreva o nome do produto.");
  } else if (kind === "pacote_venda") {
    if (!c.contactId) throw new UserFacingError("Escolha a cliente para vender o pacote.");
    const [def] = input.packageDefId ? await tx.select().from(packageDefs).where(and(eq(packageDefs.id, input.packageDefId), eq(packageDefs.active, true))) : [];
    if (!def) throw new UserFacingError("Escolha o pacote.");
    label = def.name;
    basePrice = def.priceCents ?? null;
    unitCents = input.unitCents !== undefined && input.unitCents !== null ? input.unitCents : basePrice;
    base.packageDefId = def.id;
    base.professionalId = null;
  } else if (kind === "divida") {
    // Quitar a dívida de uma comanda anterior da mesma cliente: até o que falta dela (pode ser menos; mais é recusado).
    if (!c.contactId) throw new UserFacingError("Escolha a cliente para quitar a dívida.");
    const [due] = input.settlesComandaId && isUuid(input.settlesComandaId) ? await tx.select().from(comandas).where(eq(comandas.id, input.settlesComandaId)) : [];
    if (!due || due.id === c.id) throw new UserFacingError("Escolha a dívida.");
    if (due.contactId !== c.contactId) throw new UserFacingError("Essa dívida não é desta cliente.");
    const owed = await comandaDebtRemaining(due.id, tx);
    if (due.status !== "fechada" || owed <= 0) throw new UserFacingError("Essa comanda não tem dívida.");
    if (qty !== 1) throw new UserFacingError("A dívida entra uma vez só.");
    if ((input.discountCents ?? 0) > 0 || (input.discountPercent ?? 0) > 0) throw new UserFacingError("A dívida não tem desconto.");
    const [inHere] = await tx.select({ v: sql<number>`coalesce(sum(${comandaItems.unitCents}), 0)::int` }).from(comandaItems)
      .where(and(eq(comandaItems.comandaId, c.id), eq(comandaItems.settlesComandaId, due.id), isNull(comandaItems.cancelledAt), ignoreItemId ? ne(comandaItems.id, ignoreItemId) : undefined));
    const left = owed - (inHere?.v ?? 0);
    unitCents = input.unitCents ?? left;
    if (unitCents > left) throw new UserFacingError(debtOverMessage(left));
    if (unitCents <= 0) throw new UserFacingError("Digite um valor maior que zero.");
    label = `Dívida da comanda ${due.number} de ${dm(due.day)}`;
    Object.assign(base, { professionalId: null, serviceId: null, settlesComandaId: due.id });
  } else {
    const [cp] = input.clientPackageId ? await tx.select().from(clientPackages).where(eq(clientPackages.id, input.clientPackageId)) : [];
    if (!cp || cp.cancelledAt || !c.contactId || cp.contactId !== c.contactId) throw new UserFacingError("Esse pacote não é desta cliente.");
    if (cp.validUntil && cp.validUntil < c.day) throw new UserFacingError(`O pacote venceu em ${dm(cp.validUntil)}. Só a gestão dá novo prazo.`);
    const [inUse] = await tx.select({ q: sql<number>`coalesce(sum(${comandaItems.qty}), 0)::int` }).from(comandaItems)
      .where(and(eq(comandaItems.comandaId, c.id), eq(comandaItems.clientPackageId, cp.id), isNull(comandaItems.cancelledAt), ignoreItemId ? ne(comandaItems.id, ignoreItemId) : undefined));
    if (cp.totalSessions - cp.usedSessions - (inUse?.q ?? 0) < qty) throw new UserFacingError(`O pacote de ${firstName(cp.clientName) ?? "a cliente"} não tem mais sessões.`);
    label = `${cp.serviceLabel ?? cp.packageName} (pacote)`;
    unitCents = 0; // já foi pago no pacote
    base.clientPackageId = cp.id;
    base.serviceId = await serviceIdByLabel(tx, cp.serviceLabel);
    if (!base.professionalId) throw new UserFacingError(`Escolha a profissional de ${cp.serviceLabel ?? "a sessão"}.`);
  }
  if (unitCents != null && (!Number.isInteger(unitCents) || unitCents < 0)) throw new UserFacingError("Preço inválido.");
  const gross = itemGross({ qty, unitCents }) ?? 0;
  const discountCents = discountFrom({ cents: input.discountCents, percent: input.discountPercent }, gross);
  if (discountCents > gross) throw new UserFacingError("Desconto maior que o valor do item.");
  return { ...base, label, unitCents, discountCents, basePrice };
}

export async function addItem(comandaId: string, input: AddItemInput, actor: Actor, now = new Date()): Promise<{ id: string }> {
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    assertOpen(c);
    return addItemTx(tx, c, { ...input, ruleDiscount: undefined }, actor, now);
  });
  await afterCaixaChange([r.day]);
  return { id: r.id };
}

/** Soma o item na comanda (já travada e aberta): confere preço e desconto com motivo e grava a auditoria. */
export async function addItemTx(tx: Tx, c: Comanda, input: AddItemInput, actor: Actor, now: Date): Promise<{ id: string; day: string }> {
  {
    const { basePrice, ...item } = await buildItemTx(tx, c, input);
    const reason = reasonOf(input.reason);
    const changed = basePrice != null && item.unitCents !== basePrice;
    if (changed && !reason) throw new UserFacingError(PRICE_REASON);
    if (item.discountCents > 0 && !reason) throw new UserFacingError(DISCOUNT_REASON);
    const [it] = await tx.insert(comandaItems).values({
      comandaId: c.id, ...item, addedBy: actor.id, createdAt: now, originalUnitCents: basePrice, fiscalKind: fiscalKindOf(item.kind),
      priceReason: changed ? reason : null, discountReason: item.discountCents > 0 ? reason : null,
    }).returning({ id: comandaItems.id });
    if (item.professionalId && (item.kind === "servico" || item.kind === "pacote_sessao")) await fillSuggestedAssistantsTx(tx, it.id, item.professionalId, actor.id);
    const approvedBy = (changed || item.discountCents > 0) && input.ruleDiscount !== "fidelidade" ? await comandaApprovalTx(tx, c.id, input.approverId) : null;
    const approval = approvedBy ? { aprovadoPor: approvedBy } : {};
    if (changed) await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "preco_alterado", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: item.label, de: basePrice, para: item.unitCents, motivo: reason, ...approval } });
    if (item.discountCents > 0) await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "desconto", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: item.label, valor: item.discountCents, percentual: input.discountPercent ?? null, motivo: reason, ...approval } });
    await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
    return { id: it.id, day: c.day };
  }
}

export type ItemPatch = { qty?: number; unitCents?: number | null; discountCents?: number | null; discountPercent?: number | null; professionalId?: string | null; label?: string; reason?: string | null;
  /** Quem da gestão aprovou o desconto acima do limite. */ approverId?: string | null };

/**
 * Muda preço, quantidade, desconto ou profissional de um item (7.1). Decisão do dono (17/10): todos podem mudar o preço e dar desconto,
 * sempre com motivo e rastro: o preço anterior fica no item e a mudança vai para a auditoria. Preencher um preço vazio não pede motivo.
 */
export async function updateItem(itemId: string, patch: ItemPatch, actor: Actor, now = new Date()): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const [it] = isUuid(itemId) ? await tx.select().from(comandaItems).where(eq(comandaItems.id, itemId)) : [];
    if (!it || it.cancelledAt) throw new UserFacingError("Item não encontrado.");
    const c = await lockComandaTx(tx, it.comandaId);
    assertOpen(c);
    if (it.kind === "divida") throw new UserFacingError("Tire o item da dívida e lance de novo com o valor certo.");
    // Item do prêmio da fidelidade: só a profissional muda (o desconto dele não passa pela aprovação).
    const touchesPrice = (patch.qty !== undefined && patch.qty !== Number(it.qty)) || (patch.unitCents !== undefined && patch.unitCents !== it.unitCents)
      || patch.discountPercent != null || (patch.discountCents !== undefined && patch.discountCents !== it.discountCents);
    if (touchesPrice && (await rewardItemIdsTx(tx, c.id)).has(it.id)) throw new UserFacingError("Esse item é prêmio da fidelidade. Tire o prêmio e use de novo para mudar.");
    const next = await buildItemTx(tx, c, {
      kind: it.kind as ItemKind, serviceId: it.serviceId, label: patch.label ?? it.label, professionalId: patch.professionalId !== undefined ? patch.professionalId : it.professionalId,
      qty: patch.qty ?? Number(it.qty), unitCents: patch.unitCents !== undefined ? patch.unitCents : it.unitCents, clientPackageId: it.clientPackageId, packageDefId: it.packageDefId, productId: it.productId,
      discountCents: patch.discountPercent != null ? null : patch.discountCents !== undefined ? patch.discountCents : it.discountCents, discountPercent: patch.discountPercent ?? null,
    }, it.id);
    const reason = reasonOf(patch.reason);
    const priceChanged = it.unitCents != null && next.unitCents !== it.unitCents;
    const discountChanged = next.discountCents !== it.discountCents && next.discountCents > 0;
    if (priceChanged && !reason) throw new UserFacingError(PRICE_REASON);
    if (discountChanged && !reason) throw new UserFacingError(DISCOUNT_REASON);
    await tx.update(comandaItems).set({
      label: it.kind === "produto" ? next.label : it.label, qty: next.qty, unitCents: next.unitCents, discountCents: next.discountCents, professionalId: next.professionalId,
      ...(priceChanged ? { originalUnitCents: it.originalUnitCents ?? it.unitCents, priceReason: reason } : {}),
      ...(discountChanged ? { discountReason: reason } : next.discountCents === 0 ? { discountReason: null } : {}),
    }).where(eq(comandaItems.id, it.id));
    // Trocar a profissional do item troca as assistentes pelas sugeridas da nova; vira rastro só se mudou alguma.
    if (next.professionalId !== it.professionalId && (it.kind === "servico" || it.kind === "pacote_sessao")) {
      const before = await assistantNamesTx(tx, it.id);
      await fillSuggestedAssistantsTx(tx, it.id, next.professionalId, actor.id);
      const after = await assistantNamesTx(tx, it.id);
      if (before.join("\n") !== after.join("\n")) await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "assistente_alterado", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: it.label, de: before, para: after } });
    }
    // O preço abaixo da tabela conta como desconto; o limite olha a comanda inteira, já com a mudança.
    const approvedBy = priceChanged || discountChanged ? await comandaApprovalTx(tx, c.id, patch.approverId) : null;
    const approval = approvedBy ? { aprovadoPor: approvedBy } : {};
    if (priceChanged) await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "preco_alterado", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: it.label, de: it.unitCents, para: next.unitCents, motivo: reason, ...approval } });
    if (discountChanged) await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "desconto", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: it.label, valor: next.discountCents, percentual: patch.discountPercent ?? null, motivo: reason, ...approval } });
    await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
    return c.day;
  });
  await afterCaixaChange([day]);
}

/** Tirar item: o motivo é opcional, o rastro não (auditoria "item_cancelado"). */
export async function removeItem(itemId: string, input: { reason?: string | null }, actor: Actor, now = new Date()): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const [it] = isUuid(itemId) ? await tx.select().from(comandaItems).where(eq(comandaItems.id, itemId)) : [];
    if (!it || it.cancelledAt) throw new UserFacingError("Item não encontrado.");
    const c = await lockComandaTx(tx, it.comandaId);
    assertOpen(c);
    await tx.update(comandaItems).set({ cancelledAt: now, cancelledBy: actor.id }).where(eq(comandaItems.id, it.id));
    await reverseLoyaltyTx(tx, c.id, { itemId: it.id, actorId: actor.id, now }); // tirar o item do prêmio devolve os pontos
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "item_cancelado", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: it.id, item: it.label, valor: itemTotalOf(it), motivo: reasonOf(input.reason) } });
    await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
    return c.day;
  });
  await afterCaixaChange([day]);
}

async function liveItems(tx: Tx, comandaId: string) {
  return tx.select().from(comandaItems).where(and(eq(comandaItems.comandaId, comandaId), isNull(comandaItems.cancelledAt))).orderBy(asc(comandaItems.createdAt));
}
export const toMath = (i: { id: string; label: string; qty: number | string; unitCents: number | null; discountCents: number; kind?: string }) =>
  ({ id: i.id, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, kind: i.kind });

/** Cortesia não paga dívida: a cortesia da comanda não passa do que não é dívida (o total sem os itens de dívida). */
const COURTESY_NOT_DEBT = "Cortesia não paga dívida.";
function assertCourtesyNotDebt(items: { kind: string }[], totals: ComandaTotals, courtesyCents: number) {
  if (courtesyCents > 0 && items.some((i) => i.kind === "divida") && courtesyCents > totals.discountableCents - totals.discountCents) throw new UserFacingError(COURTESY_NOT_DEBT);
}

/** Desconto na comanda inteira (R$ ou %), com motivo (decisão do dono, 17/10). O total nunca fica negativo. */
export async function setComandaDiscount(comandaId: string, input: { cents?: number | null; percent?: number | null; reason?: string | null; approverId?: string | null }, actor: Actor, now = new Date()): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    assertOpen(c);
    const live = await liveItems(tx, c.id);
    const { discountableCents } = comandaTotals(live.map(toMath), 0);
    if (((input.cents ?? 0) > 0 || (input.percent ?? 0) > 0) && discountableCents === 0 && live.some((i) => i.kind === "divida")) throw new UserFacingError("Desconto não vale para dívida.");
    const cents = discountFrom(input, discountableCents);
    if (cents > discountableCents) throw new UserFacingError("Desconto maior que o total.");
    const reason = reasonOf(input.reason);
    const changed = cents > 0 && cents !== c.discountCents;
    if (changed && !reason) throw new UserFacingError(DISCOUNT_REASON);
    await tx.update(comandas).set({ discountCents: cents, discountReason: cents ? (changed ? reason : c.discountReason) : null, updatedAt: now }).where(eq(comandas.id, c.id));
    const approvedBy = changed ? await comandaApprovalTx(tx, c.id, input.approverId) : null;
    if (changed) await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "desconto", entity: "comanda", entityId: c.id, data: { numero: c.number, itemId: null, item: null, valor: cents, percentual: input.percent ?? null, motivo: reason, ...(approvedBy ? { aprovadoPor: approvedBy } : {}) } });
    return c.day;
  });
  await afterCaixaChange([day]);
}

/** CPF na nota (opcional; para a nota fiscal futura). Grava só os 11 dígitos. */
export async function setComandaCpf(comandaId: string, cpf: string | null, actor: Actor, now = new Date()): Promise<void> {
  const value = cpf?.trim() ? cpf : null;
  if (value && !isValidCpf(value)) throw new UserFacingError("CPF inválido.");
  await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    if (c.status === "cancelada") throw new UserFacingError("Essa comanda foi cancelada.");
    await tx.update(comandas).set({ cpf: value ? cpfDigits(value) : null, updatedAt: now }).where(eq(comandas.id, c.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_cpf", entity: "comanda", entityId: c.id, data: { numero: c.number, informado: !!value } });
  });
}

/**
 * Nota fiscal no recebimento: "Não emitir", "Emitir sem CPF" ou "Emitir com CPF". Fica gravada na comanda (o CPF só vale com "com_cpf"; nos outros
 * é apagado, para nunca ir na nota). Com a cliente tendo recusado o CPF na nota (consentimento, Fase B), "com CPF" é recusado. Nada é emitido aqui.
 */
export async function setComandaNota(comandaId: string, input: { escolha: "nao" | "sem_cpf" | "com_cpf"; cpf?: string | null }, actor: Actor, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    if (c.status === "cancelada") throw new UserFacingError("Essa comanda foi cancelada.");
    let cpf: string | null = null;
    if (input.escolha === "com_cpf") {
      const typed = input.cpf?.trim();
      if (typed && !isValidCpf(typed)) throw new UserFacingError("CPF inválido.");
      cpf = typed ? cpfDigits(typed) : c.cpf;
      if (!cpf) throw new UserFacingError("Digite o CPF para emitir a nota com CPF.");
      if (c.contactId) {
        const [k] = await tx.select({ consent: contacts.consentCpfNota }).from(contacts).where(eq(contacts.id, c.contactId));
        if (k?.consent === false) throw new UserFacingError("A cliente não autorizou o CPF na nota.");
      }
    }
    await tx.update(comandas).set({ notaEscolha: input.escolha, cpf, updatedAt: now }).where(eq(comandas.id, c.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_nota", entity: "comanda", entityId: c.id, data: { numero: c.number, escolha: input.escolha } });
  });
}

/** Trocar a cliente da comanda (avulsa que virou cliente conhecida). Recusa se já tem item de pacote. */
export async function setComandaClient(comandaId: string, input: { contactId?: string | null; clientName?: string | null }, actor: Actor, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    assertOpen(c);
    const live = await liveItems(tx, c.id);
    if (live.some((i) => i.kind === "pacote_sessao" || i.kind === "pacote_venda")) throw new UserFacingError("Tire os itens de pacote antes de trocar a cliente.");
    if (live.some((i) => i.kind === "divida")) throw new UserFacingError("Tire o item da dívida antes de trocar a cliente.");
    if ((await rewardItemIdsTx(tx, c.id)).size) throw new UserFacingError("Tire o prêmio da fidelidade antes de trocar a cliente.");
    let name = input.clientName?.trim() || BALCAO;
    if (input.contactId) {
      const [ct] = await tx.select({ name: contacts.name }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!ct) throw new UserFacingError("Cliente não encontrada.");
      name = ct.name ?? name;
    }
    await tx.update(comandas).set({ contactId: input.contactId ?? null, clientName: name, updatedAt: now }).where(eq(comandas.id, c.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_cliente", entity: "comanda", entityId: c.id, data: { de: c.contactId, para: input.contactId ?? null } });
  });
}

export type AddPaymentInput = {
  method: PayMethod; valueCents: number; installments?: number | null; brand?: string | null; customMethodId?: string | null; note?: string | null;
  /** Cortesia acima do limite: quem da gestão aprovou. */ approverId?: string | null;
};

/** O que a comanda já recebeu (pagamentos vivos), para conferir o restante. */
async function livePaymentsTx(tx: Tx, comandaId: string) {
  return tx.select().from(comandaPayments).where(and(eq(comandaPayments.comandaId, comandaId), isNull(comandaPayments.cancelledAt))).orderBy(asc(comandaPayments.createdAt));
}

/**
 * Receber uma forma (Norte Vendas): várias na mesma comanda, uma a uma. Bandeira obrigatória no cartão; parcelas de 1 a 12 no crédito;
 * outra forma só até o restante (o dinheiro passa e vira troco ao fechar); cortesia com motivo, na auditoria. Pagamento parcial deixa a
 * comanda aberta com saldo. Grava o caixa de quem recebeu (o esperado do fechamento sai daqui).
 */
export async function addPayment(comandaId: string, input: AddPaymentInput, actor: Actor, now = new Date()): Promise<{ id: string }> {
  const method = z.enum(PAY_METHODS).parse(input.method);
  if (!Number.isInteger(input.valueCents) || input.valueCents <= 0) throw new UserFacingError("Digite um valor maior que zero.");
  const brand = isCardMethod(method) ? input.brand ?? null : null;
  if (isCardMethod(method) && !(CARD_BRANDS as readonly string[]).includes(brand ?? "")) throw new UserFacingError("Escolha a bandeira do cartão.");
  const installments = method === "credito" ? input.installments ?? 1 : null;
  if (installments != null && !(Number.isInteger(installments) && installments >= 1 && installments <= 12)) throw new UserFacingError("Parcelas de 1 a 12.");
  const note = input.note?.trim().slice(0, 200) || null;
  if (method === "cortesia" && !note) throw new UserFacingError("Escreva o motivo da cortesia.");
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    assertOpen(c);
    let customMethodId: string | null = null;
    if (method === "outra") {
      const [opt] = input.customMethodId && isUuid(input.customMethodId)
        ? await tx.select().from(paymentMethodOptions).where(and(eq(paymentMethodOptions.id, input.customMethodId), eq(paymentMethodOptions.active, true))) : [];
      if (!opt) throw new UserFacingError("Escolha qual é a outra forma.");
      customMethodId = opt.id;
    }
    const live = await liveItems(tx, c.id);
    const totals = comandaTotals(live.map(toMath), c.discountCents);
    const before = await livePaymentsTx(tx, c.id);
    const paid = before.reduce((a, p) => a + p.valueCents, 0);
    const refused = checkNewPayment({ totalCents: totals.totalCents, paidCents: paid, method, valueCents: input.valueCents });
    if (refused) throw new UserFacingError(refused);
    if (method === "cortesia") assertCourtesyNotDebt(live, totals, before.filter((p) => p.method === "cortesia").reduce((a, p) => a + p.valueCents, 0) + input.valueCents);
    if (method === "credito_cliente") {
      if (!c.contactId) throw new UserFacingError("Escolha a cliente para usar o crédito dela.");
      const [used] = await tx.select({ v: sql<number>`coalesce(sum(${comandaPayments.valueCents}), 0)::int` }).from(comandaPayments)
        .where(and(eq(comandaPayments.comandaId, c.id), eq(comandaPayments.method, "credito_cliente"), isNull(comandaPayments.cancelledAt)));
      const balance = await creditBalance(c.contactId, tx);
      if ((used?.v ?? 0) + input.valueCents > balance) throw new UserFacingError(`Saldo insuficiente: ${firstName(c.clientName) ?? "a cliente"} tem ${money(balance)} de crédito.`);
    }
    const cash = await lockOpenCashTx(tx, actor.id);
    if (!cash && (await getCaixaRules(tx)).exigeCaixaAberto) throw new CashClosedError();
    // A taxa é o retrato do momento do pagamento; desligada ou sem taxa cadastrada, fica vazia. Não sai da gaveta.
    const feeBp = (await getCaixaRecursos(tx)).taxaCartao ? await feeBpTx(tx, { method, brand, installments }) : null;
    const [p] = await tx.insert(comandaPayments).values({
      comandaId: c.id, method, valueCents: input.valueCents, installments, brand, note, customMethodId, cashSessionId: cash?.id ?? null, createdBy: actor.id, createdAt: now,
      feeBp, feeCents: feeBp == null ? null : feeCents(input.valueCents, feeBp),
    }).returning({ id: comandaPayments.id });
    const approvedBy = method === "cortesia" ? await comandaApprovalTx(tx, c.id, input.approverId) : null;
    if (method === "cortesia") await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "cortesia", entity: "comanda", entityId: c.id,
      data: { numero: c.number, valor: input.valueCents, motivo: note, pagamento: p.id, ...(approvedBy ? { aprovadoPor: approvedBy } : {}) } });
    await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
    return { id: p.id, day: c.day };
  });
  await afterCaixaChange([r.day]);
  return { id: r.id };
}

/** Dona do caixa, se ele já fechou (travado para leitura: um fechamento em andamento termina antes). Null: sem caixa ou aberto. */
async function closedSessionOwnerTx(tx: Tx, cashSessionId: string | null): Promise<string | null> {
  if (!cashSessionId) return null;
  const [cs] = await tx.select({ status: cashSessions.status, owner: teamNameOf(cashSessions.openedBy) }).from(cashSessions).where(eq(cashSessions.id, cashSessionId)).for("share");
  return cs && cs.status !== "aberto" ? firstName(cs.owner) ?? "outra pessoa" : null;
}
/** O pagamento só sai (estorno) enquanto o caixa em que entrou estiver aberto. */
async function assertPaymentSessionOpenTx(tx: Tx, cashSessionId: string | null): Promise<void> {
  const owner = await closedSessionOwnerTx(tx, cashSessionId);
  if (owner) throw new UserFacingError(`Esse pagamento entrou no caixa de ${owner}, que já fechou.`);
}

/** Estorno de um pagamento da comanda aberta: motivo opcional, sempre na auditoria. */
export async function removePayment(paymentId: string, input: { reason?: string | null }, actor: Actor, now = new Date()): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const [p] = isUuid(paymentId) ? await tx.select().from(comandaPayments).where(eq(comandaPayments.id, paymentId)) : [];
    if (!p || p.cancelledAt) throw new UserFacingError("Pagamento não encontrado.");
    const c = await lockComandaTx(tx, p.comandaId);
    assertOpen(c);
    await assertPaymentSessionOpenTx(tx, p.cashSessionId);
    const reason = input.reason?.trim().slice(0, 300) || null;
    await tx.update(comandaPayments).set({ cancelledAt: now, cancelledBy: actor.id, cancelReason: reason }).where(eq(comandaPayments.id, p.id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "estorno", entity: "comanda", entityId: c.id, data: { numero: c.number, pagamento: p.id, forma: p.method, valor: p.valueCents, motivo: reason } });
    await tx.update(comandas).set({ updatedAt: now }).where(eq(comandas.id, c.id));
    return c.day;
  });
  await afterCaixaChange([day]);
}

/** Receber exige o caixa aberto da pessoa (quando a Casa liga a regra): a tela oferece "Abrir caixa". */
export class CashClosedError extends UserFacingError {
  constructor() { super("Abra o seu caixa para receber."); }
}

const COMMISSIONED: ItemKind[] = ["servico", "pacote_sessao"];

/**
 * "Emitir a nota ao fechar" ligado e a chave da NFS-e ou da NFC-e em Teste ou Produção: o .pfx é lido ANTES da transação do fechamento
 * (disco, ~100 ms). `nfse`/`nfce`: quais notas entram na fila.
 */
async function prepareNotaAoFechar(): Promise<{ cert: FiscalCert | null; error?: string; nfse: boolean; nfce: boolean } | null> {
  let nfse = false, nfce = false;
  try {
    if (!(await getFiscalEmpresa()).emitirAoFechar) return null;
    nfse = (await getNfseModo()) !== "desligada";
    nfce = (await getNfceModo()) !== "desligada";
    if (!nfse && !nfce) return null;
    return { cert: await loadFiscalCert(), nfse, nfce };
  } catch (e) {
    return { cert: null, nfse, nfce, error: e instanceof UserFacingError ? e.message : `Erro inesperado ao ler o certificado (${e instanceof Error ? e.name : "erro"}).` };
  }
}

/**
 * Fechar a comanda (7.4, regra 7), numa transação só, com a comanda travada: confere preço, profissional e pagamento; lança o crédito
 * usado e o troco guardado; congela a comissão de cada item; cria o pacote vendido e baixa a sessão usada (pacote travado);
 * finaliza os horários pela porta única do 6B (via "comanda": pagar prova a visita) e liga ao caixa aberto.
 *
 * Dívida (Fase A, item 6): com `leaveDebt`, o que falta fica como dívida da cliente (precisa de cliente e do recurso ligado); a dívida não
 * é pagamento, então não entra no caixa de ninguém. Com a regra "quando ela pagar", a comissão da comanda fica retida. Os itens "divida"
 * quitam as comandas anteriores (conferido de novo aqui, com a trava da cliente) e liberam a comissão da que zerou.
 */
export async function closeComanda(comandaId: string, input: { saveChangeAsCredit?: boolean; leaveDebt?: boolean }, actor: Actor, now = new Date()) {
  const nota = await prepareNotaAoFechar();
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    if (c.status === "fechada") {
      const [who] = await tx.select({ n: teamNameOf(comandas.closedBy) }).from(comandas).where(eq(comandas.id, c.id));
      throw new UserFacingError(`Essa comanda acabou de ser fechada por ${firstName(who?.n) ?? "outra pessoa"}`);
    }
    assertOpen(c);
    const cash = await getOpenCashTx(tx, actor.id);
    // Nota fiscal: a escolha da recepção, ou o padrão da Casa (Configurações › Caixa). "Não emitir" não entra na fila.
    const padrao = (await getCaixaRules()).notaPadrao;
    // "Perguntar" (padrão): a recepção escolhe na comanda. Com a emissão ligada, fechar sem escolher é recusado; com ela desligada, vale "Não emitir".
    if (!c.notaEscolha && padrao === "perguntar" && nota) throw new UserFacingError("Escolha a nota fiscal antes de fechar a comanda.");
    const escolha = (c.notaEscolha ?? (padrao === "perguntar" ? "nao" : padrao)) as "nao" | "sem_cpf" | "com_cpf";
    if (escolha === "com_cpf" && !c.cpf) throw new UserFacingError("Digite o CPF para emitir a nota com CPF.");

    const items = await liveItems(tx, c.id);
    const totals = comandaTotals(items.map(toMath), c.discountCents);
    if (totals.missingPrice.length) throw new UserFacingError(`Falta o preço de ${totals.missingPrice[0]}.`);
    const noPro = items.find((i) => COMMISSIONED.includes(i.kind as ItemKind) && !i.professionalId);
    if (noPro) throw new UserFacingError(`Falta a profissional de ${noPro.label}.`);
    const pays = await livePaymentsTx(tx, c.id);
    assertCourtesyNotDebt(items, totals, pays.filter((p) => p.method === "cortesia").reduce((a, p) => a + p.valueCents, 0));
    const paid = pays.reduce((a, p) => a + p.valueCents, 0);
    const debtCents = input.leaveDebt && paid < totals.totalCents ? totals.totalCents - paid : 0;
    if (debtCents) {
      if (!(await getCaixaRecursos(tx)).divida) throw new UserFacingError(recursoOffMessage("divida"));
      if (!c.contactId) throw new UserFacingError("Escolha a cliente para deixar a dívida.");
      // Não rola a dívida: quitar a antiga deixando uma nova liberaria a comissão sem a cliente pagar.
      if (items.some((i) => i.kind === "divida")) throw new UserFacingError("Tire o item da dívida antes de deixar dívida nesta comanda.");
    }
    const check = debtCents ? { ok: true as const, paidCents: paid, changeCents: 0 } : checkPayments(totals.totalCents, pays.map((p) => ({ method: p.method as PayMethod, valueCents: p.valueCents })));
    if (!check.ok) throw new UserFacingError(check.error);

    // Dívida: a desta comanda (+) e as quitações das anteriores (−), sempre pelo valor cheio do item (fica fora do desconto e da cortesia).
    if (debtCents) await leaveDebtTx(tx, { contactId: c.contactId!, comandaId: c.id, cents: debtCents }, actor.id);
    const settles = items.filter((i) => i.kind === "divida" && i.settlesComandaId);
    if (settles.length) {
      if (!c.contactId) throw new UserFacingError("Escolha a cliente para quitar a dívida.");
      const parts = new Map<string, number>();
      for (const i of settles) parts.set(i.settlesComandaId!, (parts.get(i.settlesComandaId!) ?? 0) + (itemTotalOf(i) ?? 0));
      await settleDebtsTx(tx, { contactId: c.contactId, paidInComandaId: c.id, parts: new Map([...parts].filter(([, v]) => v > 0)) }, actor.id, now);
    }
    const held = debtCents > 0 && (await getCommissionRules(tx)).divida === "quitacao";

    // Crédito da cliente: usado (−) e troco guardado (+), com a trava da cliente.
    const creditUsed = pays.filter((p) => p.method === "credito_cliente").reduce((a, p) => a + p.valueCents, 0);
    if (creditUsed) await addCreditTx(tx, { contactId: c.contactId!, deltaCents: -creditUsed, reason: "pagamento", comandaId: c.id }, actor.id, c.clientName);
    let changeCents = check.changeCents, creditCents = 0;
    if (input.saveChangeAsCredit && changeCents > 0) {
      if (!c.contactId) throw new UserFacingError("Escolha a cliente para guardar o troco como crédito.");
      await addCreditTx(tx, { contactId: c.contactId, deltaCents: changeCents, reason: "troco", comandaId: c.id }, actor.id, c.clientName);
      creditCents = changeCents; changeCents = 0;
    }
    // O troco sai do último dinheiro recebido (o caixa de quem recebeu o dinheiro devolve). Guardado como crédito, o dinheiro fica na gaveta.
    let left = changeCents;
    for (const p of pays.filter((x) => x.method === "dinheiro").reverse()) {
      const part = Math.min(left, p.valueCents);
      if (part > 0) {
        const owner = await closedSessionOwnerTx(tx, p.cashSessionId);
        if (owner) throw new UserFacingError(`O troco sairia do caixa de ${owner}, que já fechou. A gestão reabre esse caixa primeiro.`);
      }
      await tx.update(comandaPayments).set({ changeCents: part }).where(eq(comandaPayments.id, p.id));
      left -= part;
    }

    // Pacotes usados: travados em ordem (evita impasse), conferidos de novo e baixados.
    const sessionItems = items.filter((i) => i.kind === "pacote_sessao" && i.clientPackageId);
    const pkgIds = [...new Set(sessionItems.map((i) => i.clientPackageId!))].sort();
    const pkgs = new Map<string, typeof clientPackages.$inferSelect>();
    for (const id of pkgIds) { const [p] = await tx.select().from(clientPackages).where(eq(clientPackages.id, id)).for("update"); if (p) pkgs.set(id, p); }
    const proNames = new Map((await tx.select({ id: professionals.id, name: professionals.name }).from(professionals)).map((p) => [p.id, p.name]));
    for (const it of sessionItems) {
      const p = pkgs.get(it.clientPackageId!)!;
      const qty = Number(it.qty);
      if (p.cancelledAt) throw new UserFacingError(`O pacote ${p.packageName} foi cancelado.`);
      if (p.validUntil && p.validUntil < c.day) throw new UserFacingError(`O pacote venceu em ${dm(p.validUntil)}. Só a gestão dá novo prazo.`);
      if (p.totalSessions - p.usedSessions < qty) throw new UserFacingError(`O pacote de ${firstName(p.clientName ?? c.clientName) ?? "a cliente"} não tem mais sessões.`);
      p.usedSessions += qty;
      await tx.update(clientPackages).set({ usedSessions: p.usedSessions, updatedAt: now }).where(eq(clientPackages.id, p.id));
      await tx.insert(packageUses).values({ clientPackageId: p.id, contactId: c.contactId, clientName: c.clientName, usedOn: c.day, item: it.label, professionalName: proNames.get(it.professionalId!) ?? null,
        professionalId: it.professionalId, comanda: String(c.number), externalKey: `crm:uso:${it.id}`, origin: "crm", comandaItemId: it.id })
        // Comanda reaberta e fechada de novo: o uso cancelado volta (a chave é do item).
        .onConflictDoUpdate({ target: packageUses.externalKey, set: { cancelledAt: null, usedOn: c.day, contactId: c.contactId, clientName: c.clientName, professionalId: it.professionalId, professionalName: proNames.get(it.professionalId!) ?? null } });
    }

    // Comissão congelada (retrato): bruta, cada desconto, as assistentes e o que fica para a principal (Fase A, commission-snapshot.ts).
    await snapshotCommissionsTx(tx, { comanda: c, items, pays, totals, pkgs, held });

    // Pacote vendido: nasce agora (nada antes de fechar), uma linha por serviço do pacote.
    for (const it of items.filter((i) => i.kind === "pacote_venda" && i.packageDefId)) {
      const [def] = await tx.select().from(packageDefs).where(eq(packageDefs.id, it.packageDefId!));
      const svcLabels = new Map((await tx.select({ id: lists.id, label: lists.label }).from(lists).where(inArray(lists.id, def.items.map((d) => d.serviceId)))).map((x) => [x.id, x.label]));
      const qty = Number(it.qty);
      await tx.insert(clientPackages).values(def.items.map((d) => ({
        contactId: c.contactId, clientName: c.clientName, packageName: def.name, serviceLabel: svcLabels.get(d.serviceId) ?? null, totalSessions: d.sessions * qty, usedSessions: 0,
        priceCents: def.items.length === 1 ? itemTotalOf(it) : null, unitCents: d.unitCents, purchasedOn: c.day, validUntil: def.validityDays ? shiftDay(c.day, def.validityDays) : null,
        origin: "crm", externalKey: `crm:pac:${it.id}:${d.serviceId}`, packageDefId: def.id, comandaItemId: it.id,
      }))).onConflictDoUpdate({ target: clientPackages.externalKey, // reaberta e fechada de novo: o pacote cancelado volta, zerado
        set: { cancelledAt: null, usedSessions: 0, totalSessions: sql`excluded.total_sessions`, priceCents: sql`excluded.price_cents`, purchasedOn: sql`excluded.purchased_on`,
          validUntil: sql`excluded.valid_until`, contactId: sql`excluded.contact_id`, clientName: sql`excluded.client_name`, updatedAt: now } });
    }

    // Produtos vendidos: baixa o estoque (pode ficar negativo; nunca trava o caixa).
    await saleMovementsTx(tx, c.id, actor.id, now);

    // Horários da comanda: Finalizado pela porta única (chama o funil do 1C).
    const days = new Set<string>([c.day]);
    const dealIds: string[] = [], finished: string[] = [];
    const apptIds = [...new Set(items.map((i) => i.appointmentId).filter((x): x is string => !!x))];
    // Só os do dia da comanda (ou antes): pagar hoje um horário de outro dia é "pago antes do horário" e ele continua marcado (7.9).
    const live = apptIds.length ? await tx.select({ id: appointments.id, status: appointments.status, startsAt: appointments.startsAt }).from(appointments).where(inArray(appointments.id, apptIds)) : [];
    for (const a of live.filter((x) => ["agendado", "confirmado", "chegou", "em_atendimento"].includes(x.status) && dayOf(x.startsAt) <= c.day)) {
      const s = await setAppointmentStatusTx(tx, a.id, "compareceu", actor.id, { via: "comanda", now });
      days.add(s.day); dealIds.push(...s.dealIds);
      if (s.changed) finished.push(a.id);
    }

    await accrueLoyaltyTx(tx, c.id, actor.id, now); // fidelidade: um ponto por serviço que conta (fechar de novo não duplica)
    await tx.update(comandas).set({
      status: "fechada", subtotalCents: totals.subtotalCents, totalCents: totals.totalCents, paidCents: check.paidCents, changeCents, discountCents: totals.discountCents, debtCents,
      cashSessionId: cash?.id ?? null, closedBy: actor.id, closedAt: now, updatedAt: now, notaEscolha: escolha,
    }).where(eq(comandas.id, c.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_fechada", entity: "comanda", entityId: c.id,
      data: { numero: c.number, total: totals.totalCents, pago: check.paidCents, troco: changeCents, credito: creditCents, formas: pays.map((p) => p.method),
        ...(debtCents ? { divida: debtCents, comissaoRetida: held } : {}) } });
    // Nota fiscal ao fechar (Configurações › Nota fiscal, desligado por padrão): só entra na fila (o worker envia). Nenhum erro da nota
    // segura o fechamento: o savepoint volta, o motivo vai para a auditoria (sem dado pessoal) e a comanda mostra "Emitir nota".
    // A NFS-e (serviços) e a NFC-e (produtos) são notas separadas, cada uma no seu savepoint: o problema de uma não segura a outra.
    const filas = nota && escolha !== "nao" ? [
      ...(nota.nfse ? [{ tipo: "nfse", queue: (sp: Tx) => queueNfseTx(sp, c.id, actor.id, now, { cert: nota.cert, quietIfNoService: true }) }] : []),
      ...(nota.nfce ? [{ tipo: "nfce", queue: (sp: Tx) => queueNfceTx(sp, c.id, actor.id, now, { cert: nota.cert, quietIfNoProduct: true }) }] : []),
    ] : [];
    for (const f of filas) {
      try {
        if (nota!.error) throw new UserFacingError(nota!.error);
        await tx.transaction((sp) => f.queue(sp));
      } catch (e) {
        const motivo = e instanceof UserFacingError ? e.message : `Erro inesperado ao preparar a nota (${e instanceof Error ? e.name : "erro"}).`;
        await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "nota_nao_enviada", entity: "comanda", entityId: c.id, data: { numero: c.number, tipo: f.tipo, motivo } });
      }
    }
    return { number: c.number, day: c.day, totalCents: totals.totalCents, changeCents, creditCents, debtCents, days: [...days], dealIds, finished };
  });
  await afterAgendaChange(r.days, r.dealIds);
  // Fase B: os horários Finalizados pela comanda podem concluir a visita → Depois do atendimento (mesmo caminho do Finalizado da Agenda;
  // um item por visita, então não duplica). Depois do commit; engole o erro.
  if (r.finished.length) await (await import("../after-visit")).afterVisitAfterCommit(r.finished, now);
  for (const day of r.days) await emit("caixa_alterado", { day });
  return { number: r.number, day: r.day, totalCents: r.totalCents, changeCents: r.changeCents, creditCents: r.creditCents, debtCents: r.debtCents };
}

const itemTotalOf = (i: { qty: number | string; unitCents: number | null; discountCents: number }) =>
  i.unitCents == null ? null : Math.max(0, Math.round(Number(i.qty) * i.unitCents) - i.discountCents);

/** Comanda aberta que não vai ser usada: some da lista (quem opera o caixa). Fechada só a gestão cancela. */
export async function discardComanda(comandaId: string, actor: Actor, now = new Date(), opts: { reason?: string } = {}): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    if (c.status === "fechada") throw new UserFacingError("Comanda fechada: só a gestão cancela, com motivo.");
    if (c.status === "cancelada") return c.day;
    // Pagamento parcial já entrou num caixa: descartar tiraria esse dinheiro da conta do caixa sem estorno.
    if ((await livePaymentsTx(tx, c.id)).length) throw new UserFacingError("Essa comanda já recebeu pagamento: estorne antes de descartar.");
    await reverseLoyaltyTx(tx, c.id, { actorId: actor.id, now }); // o prêmio usado nela volta
    await tx.update(comandas).set({ status: "cancelada", cancelledBy: actor.id, cancelledAt: now, cancelReason: opts.reason?.trim() || "descartada", updatedAt: now }).where(eq(comandas.id, c.id));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_descartada", entity: "comanda", entityId: c.id, data: { numero: c.number, ...(opts.reason?.trim() ? { motivo: opts.reason.trim() } : {}) } });
    return c.day;
  });
  await afterCaixaChange([day]);
}

/** Quanto tempo o cancelamento de uma comanda aberta pode ser desfeito (psico r68 #1: o clique errado não custa a comanda inteira). */
export const UNDO_DISCARD_MS = 10 * 60_000;

/**
 * Desfaz o cancelamento de uma comanda ABERTA (nunca fechada; sem pagamento, que o cancelamento já exige) dentro de 10 minutos: ela volta
 * a "aberta" com os mesmos itens. Se o prêmio de fidelidade usado nela já voltou para a cliente, não desfaz (refaz a comanda).
 */
export async function undoDiscardComanda(comandaId: string, actor: Actor, now = new Date()): Promise<void> {
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    if (c.status !== "cancelada") throw new UserFacingError("Essa comanda não está cancelada.");
    if (c.closedAt) throw new UserFacingError("Essa comanda já tinha sido fechada: para voltar, reabra pela gestão.");
    if (!c.cancelledAt || now.getTime() - c.cancelledAt.getTime() > UNDO_DISCARD_MS) throw new UserFacingError("Já passaram 10 minutos do cancelamento: abra uma comanda nova.");
    const [loyalty] = await tx.select({ id: auditLog.id }).from(auditLog)
      .where(and(eq(auditLog.action, "fidelidade_estornada"), eq(auditLog.entityId, c.id), gte(auditLog.createdAt, c.cancelledAt))).limit(1);
    if (loyalty) throw new UserFacingError("O prêmio de fidelidade desta comanda já voltou para a cliente: abra uma comanda nova.");
    try {
      await tx.update(comandas).set({ status: "aberta", cancelledBy: null, cancelledAt: null, cancelReason: null, updatedAt: now }).where(eq(comandas.id, c.id));
    } catch (e) {
      if (String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === "23505") throw new UserFacingError("Já existe outra comanda aberta para esta visita.");
      throw e;
    }
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_descarte_desfeito", entity: "comanda", entityId: c.id, data: { numero: c.number, motivoDesfeito: c.cancelReason } });
    return c.day;
  });
  await afterCaixaChange([day]);
}

/**
 * Desfaz o que FECHAR a comanda fez (7.4, regra 8), sem mexer nos pagamentos: crédito lançado (usado e troco guardado), pacote vendido
 * (recusa se já teve sessão usada), sessão de pacote baixada, retrato da comissão e o troco gravado no dinheiro. Devolve os itens vivos.
 * Dívida: estorna a que esta comanda deixou (recusa se parte já foi paga) e devolve a que ela quitou.
 * Comissão já paga num recibo (desta comanda ou da que ela quitou, quando a quitação liberou a comissão retida): recusa (PaidCommissionError).
 */
async function undoCloseTx(tx: Tx, c: Comanda, reason: string, actor: Actor, now: Date) {
  // Decisão 11: comissão já paga num recibo trava a comanda (reabrir, cancelar e reabrir para corrigir passam por aqui).
  await assertCommissionNotPaidTx(tx, c);
  // Nota fiscal autorizada (ou indo para o governo): reabrir ou cancelar deixaria a nota solta. Vale para as três portas (Review Focus 1);
  // a nota incerta (erro_envio) já foi conferida no governo antes da transação (settleNoteBeforeReopen).
  await assertNoAuthorizedNoteTx(tx, c.id, actor.id, now);
  const items = await liveItems(tx, c.id);
  await undoDebtsTx(tx, c, actor.id, now);
  if (c.debtCents) await tx.update(comandas).set({ debtCents: 0 }).where(eq(comandas.id, c.id));
  // Pacote vendido aqui que já foi usado: desfazer deixaria o saldo errado.
  const sold = items.filter((i) => i.kind === "pacote_venda").map((i) => i.id);
  const soldPkgs = sold.length ? await tx.select().from(clientPackages).where(and(inArray(clientPackages.comandaItemId, sold), isNull(clientPackages.cancelledAt))).for("update") : [];
  if (soldPkgs.some((p) => p.usedSessions > 0)) throw new UserFacingError("O pacote vendido nesta comanda já teve sessão usada: cancele a comanda dessa sessão antes.");
  // Crédito: estorna o que esta comanda lançou; o troco guardado não pode já ter sido gasto.
  const credits = await tx.select().from(clientCreditEntries).where(eq(clientCreditEntries.comandaId, c.id));
  if (c.contactId && credits.length) {
    await lockClientCreditTx(tx, c.contactId);
    const net = credits.reduce((a, e) => a + e.deltaCents, 0);
    if (net > 0 && (await creditBalance(c.contactId, tx)) < net) throw new UserFacingError("O crédito do troco desta comanda já foi usado.");
    if (net !== 0) await tx.insert(clientCreditEntries).values({ contactId: c.contactId, deltaCents: -net, reason: "estorno", comandaId: c.id, note: reason, createdBy: actor.id });
  }
  for (const p of soldPkgs) await tx.update(clientPackages).set({ cancelledAt: now, updatedAt: now }).where(eq(clientPackages.id, p.id));
  // Produtos: devolve ao estoque o que o fechamento baixou (roda mesmo com Produtos e estoque desligado).
  await reverseSaleMovementsTx(tx, c.id, now);
  // Sessões usadas: devolve ao pacote e marca o uso como cancelado.
  for (const it of items.filter((i) => i.kind === "pacote_sessao" && i.clientPackageId)) {
    const [p] = await tx.select().from(clientPackages).where(eq(clientPackages.id, it.clientPackageId!)).for("update");
    if (p) await tx.update(clientPackages).set({ usedSessions: Math.max(0, p.usedSessions - Number(it.qty)), updatedAt: now }).where(eq(clientPackages.id, p.id));
    await tx.update(packageUses).set({ cancelledAt: now }).where(and(eq(packageUses.comandaItemId, it.id), isNull(packageUses.cancelledAt)));
  }
  // Retrato da comissão (com as assistentes) e troco: refeitos no próximo fechamento.
  await clearCommissionSnapshotTx(tx, c.id);
  await tx.update(comandaPayments).set({ changeCents: 0 }).where(eq(comandaPayments.comandaId, c.id));
  return items;
}

/**
 * Decisão 11 primeiro: comissão desta comanda (ou da que ela quitou) já paga num recibo recusa antes de qualquer outra conferência
 * (caixa fechado, outro dia), para quem corrige ouvir logo o que precisa desfazer. `undoCloseTx` confere de novo, como rede.
 */
async function assertNoPaidCommissionTx(tx: Tx, c: Comanda) {
  await assertCommissionNotPaidTx(tx, c);
  await assertSettledCommissionNotPaidTx(tx, c.id);
}

/** Cancelar a fechada: desfaz o fechamento e estorna os pagamentos (cada um só enquanto o caixa em que entrou estiver aberto). */
async function cancelClosedTx(tx: Tx, c: Comanda, reasonText: string, actor: Actor, now: Date, opts: { keepLoyalty?: ("servico" | "resgate")[] } = {}) {
  if (c.status !== "fechada") throw new UserFacingError(c.status === "aberta" ? "Comanda aberta: use Descartar." : "Essa comanda já foi cancelada.");
  await assertNoPaidCommissionTx(tx, c);
  const reason = reasonText.trim();
  if (!reason) throw new UserFacingError("Escreva o motivo.");
  const pays = await livePaymentsTx(tx, c.id);
  for (const p of pays) await assertPaymentSessionOpenTx(tx, p.cashSessionId);
  const items = await undoCloseTx(tx, c, reason, actor, now);
  // Fidelidade: os pontos saem e o prêmio usado volta (ao reabrir para corrigir, o que fica em `keepLoyalty` vai para a comanda nova).
  const reverse = (["servico", "resgate"] as const).filter((r) => !opts.keepLoyalty?.includes(r));
  if (reverse.length) await reverseLoyaltyTx(tx, c.id, { reasons: reverse, actorId: actor.id, now });
  for (const p of pays) {
    await tx.update(comandaPayments).set({ cancelledAt: now, cancelledBy: actor.id, cancelReason: reason }).where(eq(comandaPayments.id, p.id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "estorno", entity: "comanda", entityId: c.id, data: { numero: c.number, pagamento: p.id, forma: p.method, valor: p.valueCents, motivo: reason } });
  }
  // Comissão: os itens cancelados saem do relatório.
  await tx.update(comandaItems).set({ cancelledAt: now, cancelledBy: actor.id }).where(and(eq(comandaItems.comandaId, c.id), isNull(comandaItems.cancelledAt)));
  await tx.update(comandas).set({ status: "cancelada", cancelledBy: actor.id, cancelledAt: now, cancelReason: reason, updatedAt: now }).where(eq(comandas.id, c.id));
  await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_cancelada", entity: "comanda", entityId: c.id, data: { numero: c.number, motivo: reason, total: c.totalCents } });
  return items;
}

/**
 * Reabrir a comanda fechada, no lugar (Plano 3): volta a "aberta" com os mesmos itens e pagamentos (o dinheiro continua no caixa em que
 * entrou); desfaz crédito, pacote e comissão, que voltam ao fechar de novo. Comanda do dia: quem opera o caixa; de outro dia: só a gestão.
 */
export async function reopenComanda(comandaId: string, input: { reason: string }, actor: Actor, now = new Date(), notaDeps?: NotaDeps): Promise<{ day: string }> {
  const reason = (input.reason ?? "").trim().slice(0, 300);
  if (!reason) throw new UserFacingError("Escreva o motivo.");
  await settleNotesBeforeReopen(comandaId, notaDeps, actor.id); // nota incerta: confere no governo antes (pode falar com a Sefin e a SEFAZ)
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    if (c.status !== "fechada") throw new UserFacingError(c.status === "aberta" ? "Essa comanda já está aberta." : "Essa comanda foi cancelada.");
    await assertNoPaidCommissionTx(tx, c);
    if (c.day !== todayBahia(now) && !can(actor.perms, "caixa.gerir")) throw new UserFacingError("Comanda de outro dia: só a gestão reabre.");
    // Pagamento em caixa já fechado: reabrir mexeria no troco dele (e a comanda poderia ficar sem como fechar nem estornar).
    for (const p of await livePaymentsTx(tx, c.id)) {
      const owner = await closedSessionOwnerTx(tx, p.cashSessionId);
      if (owner) throw new UserFacingError(`Um pagamento desta comanda entrou no caixa de ${owner}, que já fechou. A gestão reabre esse caixa primeiro.`);
    }
    if (c.visitId) {
      const [other] = await tx.select({ n: comandas.number }).from(comandas).where(and(eq(comandas.visitId, c.visitId), eq(comandas.status, "aberta")));
      if (other) throw new UserFacingError(`A visita já tem a comanda ${other.n} aberta.`);
    }
    await undoCloseTx(tx, c, reason, actor, now);
    // Os pontos saem até fechar de novo; o prêmio continua usado (o item dele segue na comanda). Função desligada: o fechar não
    // pontuaria de novo, então os pontos já somados ficam (tirar o item ou cancelar ainda tira).
    if (await isFuncaoOn("fidelidade", tx)) await reverseLoyaltyTx(tx, c.id, { reasons: ["servico"], actorId: actor.id, now });
    await tx.update(comandas).set({
      status: "aberta", closedAt: null, closedBy: null, subtotalCents: null, totalCents: null, paidCents: null, changeCents: null, cashSessionId: null,
      reopenedAt: now, reopenedBy: actor.id, reopenReason: reason, updatedAt: now,
    }).where(eq(comandas.id, c.id));
    await tx.insert(auditLog).values({ userId: actor.id, createdAt: now, action: "comanda_reaberta", entity: "comanda", entityId: c.id, data: { numero: c.number, motivo: reason, total: c.totalCents, fechadaEm: c.closedAt?.toISOString() ?? null } });
    return c.day;
  });
  await afterCaixaChange([day]);
  return { day };
}

/** Cancelar comanda fechada (gestão, `caixa.gerir` na ação). Os horários não voltam de status sozinhos. */
export async function cancelComanda(comandaId: string, input: { reason: string }, actor: Actor, now = new Date(), notaDeps?: NotaDeps): Promise<void> {
  await settleNotesBeforeReopen(comandaId, notaDeps, actor.id);
  const day = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    await cancelClosedTx(tx, c, input.reason ?? "", actor, now);
    return c.day;
  });
  await afterCaixaChange([day]);
}

/** "Reabrir para corrigir": cancela e abre uma comanda nova, aberta, com os mesmos itens (sem pagamento nem comissão). */
export async function reopenForCorrection(comandaId: string, input: { reason: string }, actor: Actor, now = new Date(), notaDeps?: NotaDeps): Promise<{ comandaId: string; number: number }> {
  await settleNotesBeforeReopen(comandaId, notaDeps, actor.id);
  const r = await db.transaction(async (tx) => {
    await assertCaixaOn(tx);
    const c = await lockComandaTx(tx, comandaId);
    // O prêmio vai junto para a comanda nova; os pontos também, se a função estiver desligada (o fechar da nova não pontuaria).
    const keepLoyalty: ("servico" | "resgate")[] = (await isFuncaoOn("fidelidade", tx)) ? ["resgate"] : ["servico", "resgate"];
    const items = await cancelClosedTx(tx, c, input.reason ?? "", actor, now, { keepLoyalty });
    const number = await nextComandaNumberTx(tx, c.day);
    const [n] = await tx.insert(comandas).values({ day: c.day, number, contactId: c.contactId, clientName: c.clientName, visitId: c.visitId, discountCents: c.discountCents, openedBy: actor.id, openedAt: now, updatedAt: now, notes: `Correção da comanda ${c.number}` }).returning();
    const copied = items.length ? await tx.insert(comandaItems).values(items.map((i, k) => ({
      comandaId: n.id, kind: i.kind, label: i.label, serviceId: i.serviceId, appointmentId: i.appointmentId, professionalId: i.professionalId, qty: i.qty, unitCents: i.unitCents,
      discountCents: i.discountCents, clientPackageId: i.clientPackageId, packageDefId: i.packageDefId, productId: i.productId, settlesComandaId: i.settlesComandaId, fiscalKind: i.fiscalKind, addedBy: actor.id, addedVia: i.addedVia, createdAt: new Date(now.getTime() + k), // mantém a ordem
    }))).returning({ id: comandaItems.id, createdAt: comandaItems.createdAt }) : [];
    // As assistentes (as do dia, inclusive trocadas à mão) vão junto: cada item novo copia as do antigo, na mesma ordem.
    const byOrder = [...copied].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    await copyAssistantsTx(tx, items.map((i, k) => [i.id, byOrder[k].id] as [string, string]), actor.id);
    // A fidelidade segue o item copiado (o k do createdAt diz de qual item antigo ele veio).
    await moveLoyaltyEntriesTx(tx, c.id, n.id, new Map(copied.map((x) => [items[x.createdAt.getTime() - now.getTime()].id, x.id])), keepLoyalty);
    await tx.insert(auditLog).values({ userId: actor.id, action: "comanda_reaberta_para_corrigir", entity: "comanda", entityId: n.id, data: { de: c.id, numeroAntigo: c.number, numeroNovo: number } });
    return { comandaId: n.id, number, day: c.day };
  });
  await afterCaixaChange([r.day]);
  return { comandaId: r.comandaId, number: r.number };
}
