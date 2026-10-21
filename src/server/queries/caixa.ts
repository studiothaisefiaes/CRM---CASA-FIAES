import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, cashSessions, clientPackages, comandaItemAssistants, comandaItems, contacts, comandaPayments, comandas, paymentMethodOptions, professionals, users } from "../db/schema";
import { CARD_BRAND_LABEL, changeFor, comandaTotals, differencesOf, isCardMethod, itemTotal, PAY_METHODS, type CardBrand, type DrawerMethod, type PayMethod } from "@/lib/comanda-math";
import { todayBahia } from "@/lib/agenda";
import { firstName } from "@/lib/authorship";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { teamNameCol, teamNameOf } from "./team-name";
import { paymentsByDay } from "./caixa-pagamentos";
import { cashSummary, getOpenCashTx, type CashSummary } from "../domain/caixa/cash";
import { creditBalance } from "../domain/caixa/credits";
import { listDebtors, openDebts, type Debtor, type OpenDebt } from "../domain/caixa/debts";
import { appointmentsInLiveComanda } from "../domain/caixa/arrivals";
import { dayVisitsOf } from "./day-visit";
import { getCaixaMode, getCaixaRules } from "../domain/caixa/mode";
import { getFuncoes } from "../domain/funcoes";
import { loyaltyOf } from "../domain/fidelidade";
import type { LoyaltyStatusView } from "@/lib/loyalty";
import type { ImageUse } from "@/lib/client-alert";
import { getCaixaRecursos } from "../domain/caixa/recursos";
import { loadNotaFiscalInfo, type NotaFiscalInfo } from "../domain/fiscal/draft";
import { isBlindFor, type CaixaMode, type CaixaRules, type NotaEscolha, type NotaPadrao } from "@/lib/caixa-settings";

export type ComandaDetail = {
  id: string; number: number; day: string; status: "aberta" | "fechada" | "cancelada"; contactId: string | null; clientName: string; visitId: string | null;
  discountCents: number; discountReason: string | null; cpf: string | null;
  items: { id: string; kind: string; label: string; qty: number; unitCents: number | null; discountCents: number; totalCents: number | null;
    serviceId?: string | null; professionalId: string | null; professionalName: string | null; appointmentId: string | null; clientPackageId: string | null; commissionCents: number | null;
    originalUnitCents: number | null; priceReason: string | null; discountReason: string | null; fiscalKind: string;
    /** Até 2, na ordem. Vazio com o recurso desligado. */ assistants: { professionalId: string; name: string; position: 1 | 2 }[];
    /** Item "divida": a comanda que ele quita. */ settlesComandaId: string | null }[];
  /** Assistente na comanda: ligado em Configurações › Caixa e o limite por serviço. */ assistentes: { on: boolean; max: 1 | 2 };
  payments: { id: string; method: string; valueCents: number; installments: number | null; brand: string | null; note: string | null; customLabel: string | null;
    changeCents: number; sessionOwnerName: string | null; createdByName: string | null;
    /** Retrato da taxa do momento do pagamento (vazio: sem taxa, desligada ou bandeira sem taxa). */ feeBp: number | null; feeCents: number | null }[];
  /** Soma das taxas do cartão. Com o recurso desligado: 0. */ feeCents: number;
  /** Total menos as taxas (a taxa não sai da gaveta; é só o que a Casa fica). */ netCents: number;
  /** Bandeiras de cartão recebidas sem taxa cadastrada (rótulos). */ missingFeeBrands: string[];
  totals: { subtotalCents: number; discountCents: number; totalCents: number; missingPrice: string[] }; paidCents: number; remainingCents: number;
  /** Troco que sairia agora (regra do Norte), antes de fechar. */ changePreviewCents: number;
  creditBalance: number | null;
  /** Dívidas abertas da cliente em outras comandas (já sem o que esta comanda está cobrando junto). */ debts: OpenDebt[];
  /** O que esta comanda deixou como dívida ao Finalizar. */ debtCents: number;
  /** "Dívida da cliente" ligado em Configurações › Caixa (desligado: não oferece deixar dívida; quitar continua). */ dividaOn: boolean;
  closedByName: string | null; closedAt: string | null; changeCents: number | null; cancelReason: string | null; reopenReason: string | null;
  /** Quando foi cancelada (o desfazer vale por 10 minutos). */ cancelledAt?: string | null;
  /** O caixa de quem está vendo. */ cashOpen: boolean; exigeCaixaAberto: boolean;
  /** 0081: avisos fixos da cliente e uso de imagem dela, para o Aviso que salta. `imageUse` vem nulo com a função uso_imagem desligada. */
  alertNotes?: string | null; imageUse?: ImageUse | null;
  /** Fidelidade (item 22): a situação da cliente em cada programa, só com a comanda aberta, a cliente escolhida e a função ligada. */ loyalty?: LoyaltyStatusView[];
  /** Bloco "Nota fiscal" (Fase D): só na comanda fechada. */ notaFiscal?: NotaFiscalInfo | null;
  /** Escolha da nota ao receber: a gravada (ou o padrão da Casa), o CPF da ficha da cliente e o consentimento dela (false = recusou). */
  notaEscolha: { escolha: NotaEscolha | null; padrao: NotaPadrao; clientCpf: string | null; consentCpf: boolean | null };
};

export async function getComandaDetail(id: string, viewerId: string, perms: readonly string[] = []): Promise<ComandaDetail | null> {
  if (!isUuid(id)) return null;
  const [c] = await db.select({ c: comandas, closedByName: teamNameOf(comandas.closedBy) }).from(comandas).where(eq(comandas.id, id));
  if (!c) return null;
  const items = await db.select({ i: comandaItems, pro: professionals.name }).from(comandaItems).leftJoin(professionals, eq(professionals.id, comandaItems.professionalId))
    .where(and(eq(comandaItems.comandaId, id), isNull(comandaItems.cancelledAt))).orderBy(asc(comandaItems.createdAt));
  const pays = await db.select({ p: comandaPayments, custom: paymentMethodOptions.label, owner: teamNameOf(cashSessions.openedBy), by: teamNameOf(comandaPayments.createdBy) })
    .from(comandaPayments).leftJoin(paymentMethodOptions, eq(paymentMethodOptions.id, comandaPayments.customMethodId)).leftJoin(cashSessions, eq(cashSessions.id, comandaPayments.cashSessionId))
    .where(and(eq(comandaPayments.comandaId, id), isNull(comandaPayments.cancelledAt))).orderBy(asc(comandaPayments.createdAt));
  const itemIds = items.map(({ i }) => i.id);
  const assistRows = itemIds.length ? await db.select({ itemId: comandaItemAssistants.comandaItemId, professionalId: comandaItemAssistants.professionalId, name: professionals.name, position: comandaItemAssistants.position })
    .from(comandaItemAssistants).innerJoin(professionals, eq(professionals.id, comandaItemAssistants.professionalId)).where(inArray(comandaItemAssistants.comandaItemId, itemIds)).orderBy(asc(comandaItemAssistants.position)) : [];
  const math = items.map(({ i }) => ({ id: i.id, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, kind: i.kind }));
  const t = comandaTotals(math, c.c.discountCents);
  const paidCents = pays.reduce((a, { p }) => a + p.valueCents, 0);
  const [open, rules, who, funcoes, recursos, notaFiscal] = await Promise.all([
    isUuid(viewerId) ? getOpenCashTx(db, viewerId) : null, getCaixaRules(),
    c.c.contactId ? db.select({ alertNotes: contacts.alertNotes, imageUse: contacts.imageUse, cpf: contacts.cpf, consent: contacts.consentCpfNota }).from(contacts).where(eq(contacts.id, c.c.contactId)).then((r) => r[0] ?? null) : null,
    getFuncoes(), getCaixaRecursos(), c.c.status === "fechada" ? loadNotaFiscalInfo(id) : null,
  ]);
  const loyalty = funcoes.fidelidade && c.c.contactId && c.c.status === "aberta" ? await loyaltyOf(c.c.contactId, new Date()) : undefined;
  const withFee = recursos.taxaCartao;
  const feeTotal = withFee ? pays.reduce((a, { p }) => a + (p.feeCents ?? 0), 0) : 0;
  const missing = withFee ? [...new Set(pays.filter(({ p }) => isCardMethod(p.method) && p.feeBp == null && p.brand).map(({ p }) => CARD_BRAND_LABEL[p.brand as CardBrand] ?? p.brand!))] : [];
  return {
    id: c.c.id, number: c.c.number, day: c.c.day, status: c.c.status as ComandaDetail["status"], contactId: c.c.contactId, clientName: c.c.clientName ?? "Cliente de balcão", visitId: c.c.visitId,
    discountCents: c.c.discountCents, discountReason: c.c.discountReason, cpf: c.c.cpf,
    items: items.map(({ i, pro }, k) => ({ id: i.id, kind: i.kind, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, totalCents: itemTotal(math[k]),
      serviceId: i.serviceId, professionalId: i.professionalId, professionalName: pro, appointmentId: i.appointmentId, clientPackageId: i.clientPackageId, commissionCents: i.commissionCents,
      originalUnitCents: i.originalUnitCents, priceReason: i.priceReason, discountReason: i.discountReason, fiscalKind: i.fiscalKind,
      assistants: recursos.assistentes ? assistRows.filter((a) => a.itemId === i.id).map((a) => ({ professionalId: a.professionalId, name: a.name, position: a.position as 1 | 2 })) : [],
      settlesComandaId: i.settlesComandaId })),
    assistentes: { on: recursos.assistentes, max: recursos.assistentesMax },
    payments: pays.map(({ p, custom, owner, by }) => ({ id: p.id, method: p.method, valueCents: p.valueCents, installments: p.installments, brand: p.brand, note: p.note, customLabel: custom,
      changeCents: p.changeCents, sessionOwnerName: owner, createdByName: by,
      feeBp: withFee ? p.feeBp : null, feeCents: withFee ? p.feeCents : null })),
    feeCents: feeTotal, netCents: t.totalCents - feeTotal, missingFeeBrands: missing,
    totals: { subtotalCents: t.subtotalCents, discountCents: t.discountCents, totalCents: t.totalCents, missingPrice: t.missingPrice },
    paidCents, remainingCents: Math.max(0, t.totalCents - paidCents), changePreviewCents: changeFor(pays.map(({ p }) => p), t.totalCents),
    creditBalance: c.c.contactId ? await creditBalance(c.c.contactId) : null,
    debts: c.c.contactId ? debtsBesides(await openDebts(c.c.contactId), id, items.map(({ i }) => i)) : [], debtCents: c.c.debtCents, dividaOn: recursos.divida,
    closedByName: c.closedByName, closedAt: c.c.closedAt?.toISOString() ?? null, changeCents: c.c.changeCents, cancelReason: c.c.cancelReason, reopenReason: c.c.reopenReason, cancelledAt: c.c.cancelledAt?.toISOString() ?? null,
    cashOpen: !!open, exigeCaixaAberto: rules.exigeCaixaAberto,
    alertNotes: who?.alertNotes ?? null, imageUse: funcoes.uso_imagem ? who?.imageUse ?? null : null,
    loyalty,
    notaEscolha: { escolha: (c.c.notaEscolha as NotaEscolha | null) ?? (rules.notaPadrao === "perguntar" ? null : rules.notaPadrao), padrao: rules.notaPadrao, clientCpf: who?.cpf ?? null, consentCpf: who?.consent ?? null },
    // Os botões do bloco seguem as permissões de quem vê; o servidor confere de novo em cada ação.
    notaFiscal: notaFiscal && { ...notaFiscal, acoes: { emitir: can(perms, "nota.emitir"), cancelar: can(perms, "nota.cancelar"), ver: can(perms, "nota.ver"), resolver: can(perms, "nota.resolver") } },
  };
}

/** As dívidas de outras comandas, menos o que esta (aberta) já cobra junto; as que zeram somem. */
function debtsBesides(all: OpenDebt[], comandaId: string, items: { kind: string; settlesComandaId: string | null; unitCents: number | null }[]): OpenDebt[] {
  return all.filter((d) => d.comandaId !== comandaId).map((d) => ({
    ...d, remainingCents: d.remainingCents - items.filter((i) => i.kind === "divida" && i.settlesComandaId === d.comandaId).reduce((a, i) => a + (i.unitCents ?? 0), 0),
  })).filter((d) => d.remainingCents > 0);
}

export type ComandaRow = { id: string; number: number; clientName: string; status: string; totalCents: number; openedAt: string; closedAt: string | null; closedByName: string | null };

export async function listDayComandas(day: string): Promise<{ abertas: ComandaRow[]; fechadas: ComandaRow[]; canceladas: number }> {
  const rows = await db.select({ c: comandas, closedByName: teamNameOf(comandas.closedBy) }).from(comandas).where(eq(comandas.day, day)).orderBy(asc(comandas.number));
  const openIds = rows.filter((r) => r.c.status === "aberta").map((r) => r.c.id);
  const items = openIds.length ? await db.select().from(comandaItems).where(and(inArray(comandaItems.comandaId, openIds), isNull(comandaItems.cancelledAt))) : [];
  const row = (r: (typeof rows)[number]): ComandaRow => ({
    id: r.c.id, number: r.c.number, clientName: r.c.clientName ?? "Cliente de balcão", status: r.c.status, openedAt: r.c.openedAt.toISOString(), closedAt: r.c.closedAt?.toISOString() ?? null, closedByName: r.closedByName,
    totalCents: r.c.status === "aberta"
      ? comandaTotals(items.filter((i) => i.comandaId === r.c.id).map((i) => ({ id: i.id, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, kind: i.kind })), r.c.discountCents).totalCents
      : r.c.totalCents ?? 0,
  });
  return { abertas: rows.filter((r) => r.c.status === "aberta").map(row), fechadas: rows.filter((r) => r.c.status === "fechada").map(row), canceladas: rows.filter((r) => r.c.status === "cancelada").length };
}

export type QueueRow = {
  id: string; number: number; day: string; clientName: string;
  /** Null nas "Pagas hoje" da contagem cega, para quem não é gestão (a soma seria o esperado do caixa). */
  totalCents: number | null; paidCents: number | null; remainingCents: number | null;
  /** A receber: desde quando está pronta (último serviço finalizado, ou a abertura). Em atendimento: a abertura. */ since: string;
  closedAt: string | null; closedByName: string | null; services: { label: string; professionalName: string | null; status: string | null }[];
};
export type CaixaQueue = { aReceber: QueueRow[]; emAtendimento: QueueRow[]; pagasHoje: QueueRow[] };

/**
 * A fila do Caixa (Plano 3): "A receber" = comandas abertas (de qualquer dia) com item e com todos os serviços de horário finalizados,
 * da que espera há mais tempo para a mais nova; "Em atendimento" = as outras abertas; "Pagas hoje" = fechadas hoje, a mais recente primeiro.
 */
export async function getCaixaQueue(now = new Date()): Promise<CaixaQueue> {
  const today = todayBahia(now);
  const rows = await db.select({ c: comandas, closedByName: teamNameOf(comandas.closedBy) }).from(comandas)
    .where(or(eq(comandas.status, "aberta"), and(eq(comandas.status, "fechada"), sql`(${comandas.closedAt} at time zone 'America/Bahia')::date = ${today}::date`)));
  const ids = rows.map((r) => r.c.id);
  const items = ids.length ? await db.select({ i: comandaItems, pro: professionals.name, status: appointments.status, finishedAt: appointments.finishedAt })
    .from(comandaItems).leftJoin(professionals, eq(professionals.id, comandaItems.professionalId)).leftJoin(appointments, eq(appointments.id, comandaItems.appointmentId))
    .where(and(inArray(comandaItems.comandaId, ids), isNull(comandaItems.cancelledAt))).orderBy(asc(comandaItems.createdAt)) : [];
  const paid = ids.length ? await db.select({ id: comandaPayments.comandaId, v: sql<number>`sum(${comandaPayments.valueCents})::int` }).from(comandaPayments)
    .where(and(inArray(comandaPayments.comandaId, ids), isNull(comandaPayments.cancelledAt))).groupBy(comandaPayments.comandaId) : [];
  const paidOf = new Map(paid.map((p) => [p.id, p.v]));
  const out: CaixaQueue = { aReceber: [], emAtendimento: [], pagasHoje: [] };
  for (const { c, closedByName } of rows) {
    const its = items.filter((x) => x.i.comandaId === c.id);
    const totalCents = c.status === "fechada" ? c.totalCents ?? 0 : comandaTotals(its.map(({ i }) => ({ id: i.id, label: i.label, qty: Number(i.qty), unitCents: i.unitCents, discountCents: i.discountCents, kind: i.kind })), c.discountCents).totalCents;
    const paidCents = paidOf.get(c.id) ?? 0;
    const appt = its.filter((x) => x.i.appointmentId);
    const ready = its.length > 0 && appt.every((x) => x.status === "compareceu");
    const lastFinish = appt.map((x) => x.finishedAt?.getTime() ?? 0).reduce((a, b) => Math.max(a, b), 0);
    const row: QueueRow = {
      id: c.id, number: c.number, day: c.day, clientName: c.clientName ?? "Cliente de balcão", totalCents, paidCents, remainingCents: Math.max(0, totalCents - paidCents),
      since: (ready && lastFinish ? new Date(lastFinish) : c.openedAt).toISOString(), closedAt: c.closedAt?.toISOString() ?? null, closedByName,
      services: its.filter((x) => x.i.kind === "servico" || x.i.kind === "pacote_sessao").map((x) => ({ label: x.i.label, professionalName: x.pro, status: x.status ?? null })),
    };
    if (c.status === "fechada") out.pagasHoje.push(row);
    else (ready ? out.aReceber : out.emAtendimento).push(row);
  }
  out.aReceber.sort((a, b) => a.since.localeCompare(b.since));
  out.emAtendimento.sort((a, b) => a.since.localeCompare(b.since));
  out.pagasHoje.sort((a, b) => (b.closedAt ?? "").localeCompare(a.closedAt ?? ""));
  return out;
}

/** Na contagem cega, quem não é gestão não vê o valor das "Pagas hoje" (QA r58, I-1): somadas, dariam o esperado do caixa. */
export function queueFor(queue: CaixaQueue, blind: boolean): CaixaQueue {
  if (!blind) return queue;
  return { ...queue, pagasHoje: queue.pagasHoje.map((r) => ({ ...r, totalCents: null, paidCents: null, remainingCents: null })) };
}
export { isBlindFor };

/**
 * O caixa de quem vê, como a tela recebe. Na contagem cega, quem não é gestão não recebe nada de onde se tire o esperado
 * (nem o recebido por forma, nem fundo, sangrias ou bandeiras): só quando abriu e quantas comandas estão abertas.
 */
export type MyCash = { sessionId: string; openedAt: string; blind: boolean; openComandas: number; expected: CashSummary["expected"] | null; byBrand: CashSummary["byBrand"] };
export type AgendadaRow = { key: string; appointmentId: string; clientName: string; at: string; services: { label: string; professionalName: string | null }[] };

/**
 * "Agendadas de hoje": as visitas do dia (mesma régua do Hoje: sem CLIENTE PADRÃO, espera às 00:00 nem cancelado) que ainda não têm comanda
 * aberta nem paga. Um clique abre a comanda da visita (`openComandaAction`).
 */
export async function listAgendadasHoje(day: string): Promise<AgendadaRow[]> {
  const visits = await dayVisitsOf(day, { withValues: false });
  const cand = visits.filter((v) => !v.comanda && v.services.length > 0);
  // Horário já lançado numa comanda (juntado por fora da visita) também tira a cliente da lista.
  const taken = await appointmentsInLiveComanda(cand.flatMap((v) => v.services.map((s) => s.appointmentId)));
  return cand.filter((v) => !v.services.some((s) => taken.has(s.appointmentId))).map((v) => ({
    key: v.key, appointmentId: v.services[0].appointmentId, clientName: v.name, at: v.entry,
    services: v.services.map((s) => ({ label: s.service, professionalName: s.pro })),
  }));
}

export type CaixaHoje = {
  day: string; mode: CaixaMode; rules: CaixaRules; mine: MyCash | null; myName: string; queue: CaixaQueue;
  /** Clientes com horário hoje e sem comanda aberta ou paga. */ agendadas: AgendadaRow[];
  /** caixa.cancelar: mostra o "Cancelar" nos cartões. */ canCancelar: boolean;
  /** "Devendo": null sem a permissão caixa.divida (a lista nem é consultada). */ devendo: Debtor[] | null;
  /** Entrou hoje por forma; null na contagem cega para quem não é gestão (numa Casa com um caixa só, seria o esperado dela). */
  totals: { byMethod: Record<PayMethod, number>; totalCents: number } | null;
};

export async function getCaixaHoje(viewer: { id: string; perms: readonly string[] }, now = new Date()): Promise<CaixaHoje> {
  const day = todayBahia(now);
  const [mode, rules, open, days, queue, [me]] = await Promise.all([
    getCaixaMode(), getCaixaRules(), getOpenCashTx(db, viewer.id), paymentsByDay({ from: day, to: day }), getCaixaQueue(now),
    db.select({ name: teamNameCol() }).from(users).where(eq(users.id, viewer.id)),
  ]);
  const blind = isBlindFor(rules, viewer);
  const sum = open ? await cashSummary(open.id) : null;
  const [agendadas, devendo] = await Promise.all([listAgendadasHoje(day), can(viewer.perms, "caixa.divida") ? listDebtors() : null]);
  const d = days[0];
  return {
    day, mode, rules, myName: firstName(me?.name) ?? me?.name ?? "", queue: queueFor(queue, blind), agendadas, devendo, canCancelar: can(viewer.perms, "caixa.cancelar"),
    mine: sum ? { sessionId: sum.session.id, openedAt: sum.session.openedAt.toISOString(), blind, openComandas: sum.openComandas, expected: blind ? null : sum.expected, byBrand: blind ? [] : sum.byBrand } : null,
    totals: blind ? null : { byMethod: d?.byMethod ?? (Object.fromEntries(PAY_METHODS.map((m) => [m, 0])) as Record<PayMethod, number>), totalCents: d?.moneyCents ?? 0 },
  };
}

export type TeamCashRow = {
  id: string; personId: string; personName: string; day: string; status: "aberto" | "fechado"; openedAt: string; closedAt: string | null; openingCents: number;
  received: Record<PayMethod, number>; expectedCash: number; differenceCents: number | null; approvedByName: string | null; closedByName: string | null;
  /** Para a gestão fechar o caixa de outra pessoa. */ expected: CashSummary["expected"]; byBrand: CashSummary["byBrand"]; openComandas: number;
  /** Fechado: contado − esperado das formas com diferença (QA r58, C-1). */ differences: { method: DrawerMethod; cents: number }[];
};

/** Caixa › Caixas da equipe (gestão): os caixas abertos (de qualquer dia) e os fechados hoje, quem abriu primeiro antes. */
export async function listTeamCash(now = new Date()): Promise<TeamCashRow[]> {
  const today = todayBahia(now);
  const rows = await db.select({ s: cashSessions, owner: teamNameOf(cashSessions.openedBy), approver: teamNameOf(cashSessions.approvedBy), closer: teamNameOf(cashSessions.closedBy) })
    .from(cashSessions).where(or(eq(cashSessions.status, "aberto"), sql`(${cashSessions.closedAt} at time zone 'America/Bahia')::date = ${today}::date`))
    .orderBy(asc(cashSessions.openedAt));
  return Promise.all(rows.map(async ({ s, owner, approver, closer }) => {
    const sum = await cashSummary(s.id);
    const received = Object.fromEntries(PAY_METHODS.map((m) => [m, sum.received.find((r) => r.method === m)?.valueCents ?? 0])) as Record<PayMethod, number>;
    return {
      id: s.id, personId: s.openedBy, personName: owner ?? "—", day: s.day, status: s.status === "aberto" ? "aberto" as const : "fechado" as const, openedAt: s.openedAt.toISOString(),
      closedAt: s.closedAt?.toISOString() ?? null, openingCents: s.openingCents, received, expectedCash: sum.expected.dinheiro, differenceCents: s.status === "aberto" ? null : s.differenceCents,
      approvedByName: approver, closedByName: closer, expected: sum.expected, byBrand: sum.byBrand, openComandas: sum.openComandas,
      differences: s.status === "fechado" ? differencesOf(s.expected, s.counted) : [],
    };
  }));
}

export type CashSessionRow = {
  id: string; day: string; status: string; openingCents: number; openedByName: string | null; closedByName: string | null; closedAt: string | null; differenceCents: number | null;
  expected: Record<string, number> | null; counted: Record<string, number> | null; approvedByName: string | null;
  /** Contado − esperado das formas com diferença (QA r58, C-1: a soma pode dar zero com dinheiro faltando). */ differences: { method: DrawerMethod; cents: number }[];
};

/** Caixa › Fechamentos. Sem `caixa.outros`, só os caixas da própria pessoa (QA r58, I-10: a diferença das colegas é da gestão). */
export async function listCashSessions(o: { viewer: { id: string; perms: readonly string[] }; limit?: number }): Promise<CashSessionRow[]> {
  const own = can(o.viewer.perms, "caixa.outros") ? undefined : eq(cashSessions.openedBy, o.viewer.id);
  const rows = await db.select({ s: cashSessions, openedByName: teamNameOf(cashSessions.openedBy), closedByName: teamNameOf(cashSessions.closedBy), approvedByName: teamNameOf(cashSessions.approvedBy) })
    .from(cashSessions).where(own).orderBy(desc(cashSessions.openedAt)).limit(o.limit ?? 30);
  return rows.map(({ s, openedByName, closedByName, approvedByName }) => ({ id: s.id, day: s.day, status: s.status, openingCents: s.openingCents, openedByName, closedByName,
    closedAt: s.closedAt?.toISOString() ?? null, differenceCents: s.differenceCents, expected: s.expected, counted: s.counted, approvedByName,
    differences: s.status === "fechado" ? differencesOf(s.expected, s.counted) : [] }));
}

/** Pacotes da cliente para "Sessão de pacote" na comanda: com sessão e ainda válidos; os vencidos aparecem marcados (a gestão dá novo prazo). */
export async function clientPackagesFor(contactId: string, day: string) {
  if (!isUuid(contactId)) return [];
  const rows = await db.select().from(clientPackages).where(and(eq(clientPackages.contactId, contactId), isNull(clientPackages.cancelledAt), sql`${clientPackages.totalSessions} > ${clientPackages.usedSessions}`))
    .orderBy(sql`${clientPackages.validUntil} asc nulls last`);
  return rows.map((p) => ({ id: p.id, label: `${p.packageName} · ${p.serviceLabel ?? ""}`.replace(/ · $/, ""), remaining: p.totalSessions - p.usedSessions, validUntil: p.validUntil, expired: !!p.validUntil && p.validUntil < day }));
}

export type AttentionPackage = { id: string; clientName: string; packageName: string; serviceLabel: string | null; remaining: number; validUntil: string | null; unitCents: number | null };

/** Caixa › Pacotes: o que pede a gestão (pacotes com sessão restante): vencidos (dar novo prazo) e sem valor por sessão (base da comissão). */
export async function listPackagesNeedingAttention(today: string): Promise<{ vencidos: AttentionPackage[]; semValor: AttentionPackage[] }> {
  const rows = await db.select().from(clientPackages).where(and(isNull(clientPackages.cancelledAt), sql`${clientPackages.totalSessions} > ${clientPackages.usedSessions}`))
    .orderBy(sql`${clientPackages.validUntil} asc nulls last`, asc(clientPackages.clientName));
  const map = (p: (typeof rows)[number]): AttentionPackage => ({ id: p.id, clientName: p.clientName ?? "Cliente", packageName: p.packageName, serviceLabel: p.serviceLabel, remaining: p.totalSessions - p.usedSessions, validUntil: p.validUntil, unitCents: p.unitCents });
  return { vencidos: rows.filter((p) => p.validUntil && p.validUntil < today).map(map), semValor: rows.filter((p) => p.unitCents == null && !(p.validUntil && p.validUntil < today)).map(map) };
}
