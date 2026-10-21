import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, ne, notInArray, notLike, or, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import { agendaBlocks, appointmentLabels, appointments, avecReports, clientPackages, contacts, professionals, salesItems, salesPayments, users } from "../db/schema";
import { normText } from "../domain/avec/normalize";
import { teamNameOf } from "./team-name";
import { isUuid } from "../../lib/uuid";
import { groupPackagePurchases, type PurchaseService } from "../../lib/package-purchases";
import { numberPhoneSql } from "../domain/people-on-number";
import { isHiddenNumber } from "@/lib/phone-client";

/**
 * Leitura do que veio do Avec (e da agenda própria): horários, bloqueios, lista de espera, pacotes, histórico da cliente e os
 * relatórios guardados. Dinheiro em centavos; valores só saem com `withValues` (quem vê valores), senão vêm null.
 */

const OFFSET_MS = 3 * 3_600_000; // America/Bahia
const dayOf = (d: Date) => new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10);

/** Período: de `from` (inclusive) até `to` (exclusive). */
export type AvecRange = { from: Date; to: Date };

export type AppointmentItem = {
  id: string; startsAt: string; durationMin: number | null; /** espera | solicitado | agendado | … (src/lib/appointment-status.ts) */ status: string; avecStatus: string | null;
  contactId: string | null; /** Nome da ficha, ou o nome que veio do Avec. */ clientName: string; phone: string | null;
  professionalId: string | null; professionalName: string | null; serviceId: string | null; serviceLabel: string;
  priceCents: number | null; notes: string | null; origin: string; createdByName: string | null; dealId: string | null;
  /* Lote 6B */
  visitId: string | null; fitIn: boolean; outsideHours: boolean; anyPro: boolean; confirmedVia: string | null; cancelReason: string | null; cancelNote: string | null;
  crmTouchedAt: string | null; /** Quem marcou no CRM (o `createdByName` é o "Quem cadastrou" do Avec). */ bookedByName: string | null;
  /** Lista de espera: manha | tarde | dia. */ waitWindow: string | null;
  /** Cor da profissional (6A). */ professionalColor: string | null;
  /** 6.11: escolhida | sem_preferencia | null (não informado). */ preference: string | null;
  /** Foto da profissional (6B.16): caminho no disco, nunca vai para a tela (vira URL em `getAgenda`). */ professionalPhotoPath: string | null;
  /** Gap Avec (A1): no Avec a reserva continua Agendado, sem baixa (último 0248). */ avecSemBaixa?: boolean;
  /** 0080: marcador do horário e tipo (indicacao | noiva); null = nenhum. */ label?: { id: string; name: string; color: string | null } | null; visitType?: string | null;
  /** 0085: a série do horário que se repete; null = avulso. */ seriesId?: string | null;
};

const appointmentCols = {
  id: appointments.id, startsAt: appointments.startsAt, durationMin: appointments.durationMin, status: appointments.status, avecStatus: appointments.avecStatus,
  avecSemBaixa: sql<boolean>`${appointments.avecUnclosedAt} is not null`,
  contactId: appointments.contactId, contactName: contacts.name, clientName: appointments.clientName, phone: numberPhoneSql(),
  professionalId: appointments.professionalId, professionalName: professionals.name, serviceId: appointments.serviceId, serviceLabel: appointments.serviceLabel,
  priceCents: appointments.priceCents, notes: appointments.notes, origin: appointments.origin, createdByName: appointments.createdByName, dealId: appointments.dealId,
  visitId: appointments.visitId, fitIn: appointments.fitIn, outsideHours: appointments.outsideHours, anyPro: appointments.anyPro, confirmedVia: appointments.confirmedVia,
  cancelReason: appointments.cancelReason, cancelNote: appointments.cancelNote, crmTouchedAt: appointments.crmTouchedAt, bookedByName: teamNameOf(appointments.createdBy),
  waitWindow: appointments.waitWindow, professionalColor: professionals.color, professionalPhotoPath: professionals.photoPath, preference: appointments.preference,
  labelId: appointmentLabels.id, labelName: appointmentLabels.name, labelColor: appointmentLabels.color, visitType: appointments.visitType,
  seriesId: appointments.seriesId,
};
const selectAppointments = (where: SQL | undefined) =>
  db.select(appointmentCols).from(appointments)
    .leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
    .leftJoin(appointmentLabels, eq(appointmentLabels.id, appointments.labelId))
    .where(where);
type AppointmentRow = Awaited<ReturnType<typeof selectAppointments>>[number];

function toAppointment(r: AppointmentRow, withValues: boolean): AppointmentItem {
  const phone = r.phone && !isHiddenNumber(r.phone) ? r.phone : null;
  const { contactName, labelId, labelName, labelColor, ...rest } = r;
  return {
    ...rest, label: labelId && labelName ? { id: labelId, name: labelName, color: labelColor } : null, startsAt: r.startsAt.toISOString(), status: r.status, crmTouchedAt: r.crmTouchedAt?.toISOString() ?? null,
    clientName: contactName?.trim() || r.clientName?.trim() || phone || "Sem nome", phone, priceCents: withValues ? r.priceCents : null,
  };
}

/**
 * Horários do período (agenda da Casa), em ordem. Lista de espera fica de fora (ver `listWaitlist`); cancelados entram, para a
 * tela mostrar riscados ou esconder. `professionalId` filtra a coluna de uma profissional.
 */
export async function listAppointments(range: AvecRange, opts: { professionalId?: string | null; withValues?: boolean } = {}): Promise<AppointmentItem[]> {
  if (opts.professionalId && !isUuid(opts.professionalId)) return [];
  const rows = await selectAppointments(and(
    gte(appointments.startsAt, range.from), lt(appointments.startsAt, range.to), ne(appointments.status, "espera"), isNull(appointments.avecTwinOf),
    opts.professionalId ? eq(appointments.professionalId, opts.professionalId) : undefined,
  )).orderBy(asc(appointments.startsAt), asc(appointments.clientName));
  return rows.map((r) => toAppointment(r, !!opts.withValues));
}

/** Lista de espera: quem quer horário, pela data pedida (mais antiga primeiro). */
/** Lista de espera; `from` (início do dia de hoje em Salvador) deixa de fora os pedidos de dias que já passaram. */
export async function listWaitlist(opts: { withValues?: boolean; from?: Date } = {}): Promise<AppointmentItem[]> {
  // Gap Avec (A1): os "espera" às 00:00 que vinham do 0248 (chave avec:esp:) não são lista de espera; a espera feita no CRM continua.
  const rows = await selectAppointments(and(eq(appointments.status, "espera"), isNull(appointments.avecTwinOf), notLike(appointments.externalKey, "avec:esp:%"),
    opts.from ? gte(appointments.startsAt, opts.from) : undefined))
    .orderBy(asc(appointments.startsAt), asc(appointments.clientName));
  return rows.map((r) => toAppointment(r, !!opts.withValues));
}

export type AgendaBlockItem = {
  id: string; professionalId: string | null; professionalName: string | null; title: string; notes: string | null;
  /** "aaaa-mm-dd" */ startsOn: string; endsOn: string; /** "HH:MM" (Salvador) */ startTime: string; endTime: string;
  /** 0=dom..6=sáb; null = todos os dias do intervalo. Use `blockAppliesOn` (src/lib/agenda-blocks) para saber se vale num dia. */ weekdays: number[] | null;
  /** avec (importado) | crm (criado aqui) */ origin: string; /** motivo do bloqueio do CRM; vazio nos do Avec */ reason: string | null;
};

/** Bloqueios que tocam o período (pelo dia em Salvador). Os apagados no CRM ficam de fora. */
export async function listAgendaBlocks(range: AvecRange, opts: { professionalId?: string | null } = {}): Promise<AgendaBlockItem[]> {
  if (opts.professionalId && !isUuid(opts.professionalId)) return [];
  const first = dayOf(range.from), last = dayOf(new Date(range.to.getTime() - 1));
  return db.select({
    id: agendaBlocks.id, professionalId: agendaBlocks.professionalId, professionalName: professionals.name, title: agendaBlocks.title, notes: agendaBlocks.notes,
    startsOn: agendaBlocks.startsOn, endsOn: agendaBlocks.endsOn, startTime: agendaBlocks.startTime, endTime: agendaBlocks.endTime, weekdays: agendaBlocks.weekdays,
    origin: agendaBlocks.origin, reason: agendaBlocks.reason,
  }).from(agendaBlocks).leftJoin(professionals, eq(professionals.id, agendaBlocks.professionalId))
    .where(and(isNull(agendaBlocks.deletedAt), lte(agendaBlocks.startsOn, last), gte(agendaBlocks.endsOn, first), opts.professionalId ? eq(agendaBlocks.professionalId, opts.professionalId) : undefined,
      // Lote 7A: na grade só bloqueio de verdade; pedido de folga fica em "Pedidos" e recusado some.
      or(isNull(agendaBlocks.requestStatus), eq(agendaBlocks.requestStatus, "aprovado"))))
    .orderBy(asc(agendaBlocks.startTime), asc(professionals.name));
}

/* ───────────── Pacotes ───────────── */

export type PackageSituation = "ativo" | "acabando" | "vencendo" | "vencido" | "esgotado";
export type ClientPackageItem = {
  id: string; contactId: string | null; clientName: string; phone: string | null; packageName: string; serviceLabel: string | null;
  totalSessions: number; usedSessions: number; /** Sessões que faltam (nunca negativo). */ remaining: number;
  priceCents: number | null; purchasedOn: string | null; validUntil: string | null;
  /** Próximo horário marcado da cliente (agendado/confirmado), ISO. */ nextAppointmentAt: string | null;
  situation: PackageSituation; /** Falta 1 sessão. */ endingSoon: boolean; /** Vence em até 30 dias. */ expiringSoon: boolean;
  /**
   * Uma COMPRA (src/lib/package-purchases.ts): o Avec grava uma linha por serviço do pacote e aqui elas viram um item só.
   * `id` = o da primeira linha; `rowIds` = todas; `services` = o uso de cada serviço (nome em Título). Sessões/situação da compra:
   * maior total e maior usado entre os serviços. `serviceLabel` só quando a compra tem uma linha.
   */
  rowIds: string[]; services: PurchaseService[];
};
export type PackageFilter = {
  contactId?: string; /** Busca por cliente ou pacote. */ q?: string;
  /** Só as vendas de um pacote do catálogo (aba Serviços › Pacotes → "clientes com o pacote ativo"). */ packageDefId?: string;
  /** ativos (padrão: ativo, acabando, vencendo) | acabando | vencendo | encerrados (vencido, esgotado) | todos */
  situacao?: "ativos" | "acabando" | "vencendo" | "encerrados" | "todos";
  withValues?: boolean;
};
export const EXPIRING_DAYS = 30;

const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function packageSituation(p: { totalSessions: number; usedSessions: number; validUntil: string | null }, today: string) {
  const remaining = Math.max(0, p.totalSessions - p.usedSessions);
  const expiringSoon = !!p.validUntil && p.validUntil >= today && p.validUntil <= addDays(today, EXPIRING_DAYS);
  const endingSoon = remaining === 1;
  const situation: PackageSituation = remaining === 0 ? "esgotado" : p.validUntil && p.validUntil < today ? "vencido" : endingSoon ? "acabando" : expiringSoon ? "vencendo" : "ativo";
  return { remaining, situation, endingSoon: remaining > 0 && endingSoon, expiringSoon: remaining > 0 && expiringSoon };
}

/** Pacotes das clientes (uma compra por item, mesmo quando o Avec gravou uma linha por serviço), os que vencem antes primeiro. */
export async function listClientPackages(filtro: PackageFilter = {}, now: Date = new Date()): Promise<ClientPackageItem[]> {
  if ((filtro.contactId && !isUuid(filtro.contactId)) || (filtro.packageDefId && !isUuid(filtro.packageDefId))) return [];
  const rows = await db.select({
    p: clientPackages, contactName: contacts.name, phone: numberPhoneSql(),
    next: sql<Date | null>`(select min(a.starts_at) from ${appointments} a where a.contact_id = ${clientPackages.contactId} and a.starts_at >= ${now} and a.status in ('agendado', 'confirmado') and a.avec_twin_of is null)`,
  }).from(clientPackages).leftJoin(contacts, eq(contacts.id, clientPackages.contactId))
    .where(and(filtro.contactId ? eq(clientPackages.contactId, filtro.contactId) : undefined, filtro.packageDefId ? eq(clientPackages.packageDefId, filtro.packageDefId) : undefined))
    .orderBy(sql`${clientPackages.validUntil} asc nulls last`, asc(clientPackages.clientName), asc(clientPackages.packageName));
  const today = dayOf(now);
  const q = normText(filtro.q);
  const want = filtro.situacao ?? (filtro.contactId ? "todos" : "ativos");
  const out: ClientPackageItem[] = [];
  const extra = new Map(rows.map((r) => [r.p.id, r]));
  for (const g of groupPackagePurchases(rows.map((r) => r.p))) {
    const r = extra.get(g.id)!;
    const s = packageSituation(g, today);
    const clientName = r.contactName?.trim() || r.p.clientName?.trim() || "Sem nome";
    if (q && !normText(`${clientName} ${r.p.clientName ?? ""} ${g.packageName} ${g.rows.map((x) => x.serviceLabel ?? "").join(" ")}`).includes(q)) continue;
    if (want === "ativos" && (s.situation === "vencido" || s.situation === "esgotado")) continue;
    if (want === "acabando" && !s.endingSoon) continue;
    if (want === "vencendo" && !s.expiringSoon) continue;
    if (want === "encerrados" && s.situation !== "vencido" && s.situation !== "esgotado") continue;
    const next = r.next ? new Date(r.next) : null;
    out.push({
      id: g.id, contactId: g.contactId, clientName, phone: r.phone && !isHiddenNumber(r.phone) ? r.phone : null, packageName: g.packageName,
      serviceLabel: g.rows.length === 1 ? g.rows[0].serviceLabel : null, rowIds: g.rowIds, services: g.services,
      totalSessions: g.totalSessions, usedSessions: g.usedSessions, priceCents: filtro.withValues ? g.priceCents : null,
      purchasedOn: g.purchasedOn, validUntil: g.validUntil, nextAppointmentAt: next ? next.toISOString() : null, ...s,
    });
  }
  return out;
}

/* ───────────── Ficha da cliente ───────────── */

export type SaleHistoryItem = {
  id: string; soldOn: string; comanda: string | null; item: string; kind: string; category: string | null; professionalName: string | null;
  qty: number; valueCents: number | null; discountCents: number | null; totalCents: number | null; fromPackage: boolean;
};
export type SalePaymentItem = { id: string; comanda: string | null; comandaOn: string | null; paidOn: string | null; method: string | null; valueCents: number | null };
export type ContactAvecData = {
  proximos: AppointmentItem[]; pacotes: ClientPackageItem[]; historico: SaleHistoryItem[]; pagamentos: SalePaymentItem[];
  /** Tudo o que veio do Avec (não só as linhas mostradas): visitas (comandas) e total gasto (null sem valores.ver). */
  totais: { comandas: number; totalCents: number | null };
};
export const CONTACT_HISTORY_LIMIT = 200;

/** O que o Avec sabe da cliente: próximos horários, pacotes (todos), histórico de atendimentos/compras e pagamentos (mais novos primeiro). */
const wvOf = (o: { withValues?: boolean }) => !!o.withValues;

export async function getContactAvecData(contactId: string, opts: { withValues?: boolean; now?: Date } = {}): Promise<ContactAvecData> {
  if (!isUuid(contactId)) return { proximos: [], pacotes: [], historico: [], pagamentos: [], totais: { comandas: 0, totalCents: wvOf(opts) ? 0 : null } };
  const now = opts.now ?? new Date(), wv = !!opts.withValues;
  const [next, pacotes, items, pays, [tot]] = await Promise.all([
    selectAppointments(and(eq(appointments.contactId, contactId), gte(appointments.startsAt, now), isNull(appointments.avecTwinOf), notInArray(appointments.status, ["cancelado", "espera", "faltou", "espera_encaixada", "espera_desistiu"])))
      .orderBy(asc(appointments.startsAt)),
    listClientPackages({ contactId, situacao: "todos", withValues: wv }, now),
    db.select({ s: salesItems, proName: professionals.name }).from(salesItems).leftJoin(professionals, eq(professionals.id, salesItems.professionalId))
      .where(eq(salesItems.contactId, contactId)).orderBy(desc(salesItems.soldOn), desc(salesItems.comanda), asc(salesItems.item)).limit(CONTACT_HISTORY_LIMIT),
    db.select().from(salesPayments).where(eq(salesPayments.contactId, contactId))
      .orderBy(sql`coalesce(${salesPayments.paidOn}, ${salesPayments.comandaOn}) desc nulls last`, desc(salesPayments.comanda)).limit(CONTACT_HISTORY_LIMIT),
    db.select({ comandas: sql<number>`count(distinct (${salesItems.soldOn}, ${salesItems.comanda}))::int`, total: sql<number>`coalesce(sum(${salesItems.totalCents}), 0)::bigint` })
      .from(salesItems).where(eq(salesItems.contactId, contactId)),
  ]);
  return {
    proximos: next.map((r) => toAppointment(r, wv)),
    pacotes,
    historico: items.map(({ s, proName }) => ({
      id: s.id, soldOn: s.soldOn, comanda: s.comanda, item: s.item, kind: s.kind, category: s.category, professionalName: proName ?? s.professionalName,
      qty: Number(s.qty), valueCents: wv ? s.valueCents : null, discountCents: wv ? s.discountCents : null, totalCents: wv ? s.totalCents : null, fromPackage: s.fromPackage,
    })),
    pagamentos: pays.map((p) => ({ id: p.id, comanda: p.comanda, comandaOn: p.comandaOn, paidOn: p.paidOn, method: p.method, valueCents: wv ? p.valueCents : null })),
    totais: { comandas: tot?.comandas ?? 0, totalCents: wv ? Number(tot?.total ?? 0) : null },
  };
}

/** Uma linha por cliente: o próximo horário e o pacote ativo (painel de contexto da conversa). */
export async function nextAppointmentsOf(contactIds: string[], now: Date = new Date()): Promise<Map<string, AppointmentItem>> {
  const ids = [...new Set(contactIds.filter(isUuid))];
  const out = new Map<string, AppointmentItem>();
  if (!ids.length) return out;
  const rows = await selectAppointments(and(inArray(appointments.contactId, ids), gte(appointments.startsAt, now), or(eq(appointments.status, "agendado"), eq(appointments.status, "confirmado")), isNull(appointments.avecTwinOf)))
    .orderBy(asc(appointments.startsAt));
  for (const r of rows) if (r.contactId && !out.has(r.contactId)) out.set(r.contactId, toAppointment(r, false));
  return out;
}

/* ───────────── Relatórios guardados ───────────── */

export type AvecReportSummary = {
  id: string; title: string; signature: string; fileName: string; rowCount: number; dateFrom: string | null; dateTo: string | null;
  importedAt: string; importedByName: string | null; /** Resumo do que entrou na 1ª importação. */ applied: Record<string, number>;
};
export type AvecReportPage = AvecReportSummary & { columns: string[]; rows: string[][]; /** Linhas que batem com a busca. */ total: number; page: number; pageSize: number; pages: number };

const reportCols = {
  id: avecReports.id, title: avecReports.title, signature: avecReports.signature, fileName: avecReports.fileName, rowCount: avecReports.rowCount,
  dateFrom: avecReports.dateFrom, dateTo: avecReports.dateTo, importedAt: avecReports.importedAt, importedByName: users.name, applied: avecReports.applied,
};
const toSummary = (r: { importedAt: Date } & Omit<AvecReportSummary, "importedAt">): AvecReportSummary => ({ ...r, importedAt: r.importedAt.toISOString() });

/** Relatórios guardados, os mais novos primeiro (sem as linhas). A tela agrupa por `title` e mostra o período. */
export async function listAvecReports(): Promise<AvecReportSummary[]> {
  const rows = await db.select(reportCols).from(avecReports).leftJoin(users, eq(users.id, avecReports.importedBy))
    .orderBy(desc(avecReports.importedAt), asc(avecReports.title));
  return rows.map(toSummary);
}

export const AVEC_REPORT_PAGE_SIZE = 50;

/** Um relatório aberto: busca (sem acento/caixa, em qualquer coluna) e paginação (página 1 = primeira). null se não existe. */
export async function getAvecReport(id: string, opts: { q?: string; page?: number; pageSize?: number } = {}): Promise<AvecReportPage | null> {
  if (!isUuid(id)) return null;
  const [r] = await db.select({ ...reportCols, columns: avecReports.columns, rows: avecReports.rows }).from(avecReports)
    .leftJoin(users, eq(users.id, avecReports.importedBy)).where(eq(avecReports.id, id));
  if (!r) return null;
  const q = normText(opts.q);
  const filtered = q ? r.rows.filter((row) => row.some((c) => normText(c).includes(q))) : r.rows;
  const pageSize = Math.min(500, Math.max(1, Math.floor(opts.pageSize ?? AVEC_REPORT_PAGE_SIZE)));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1) || 1));
  const { rows: _all, columns, ...summary } = r;
  return { ...toSummary(summary), columns, rows: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize, pages };
}

/** A tabela inteira (saneada), para Baixar Excel/PDF. */
export async function getAvecReportTable(id: string): Promise<{ title: string; fileName: string; dateFrom: string | null; dateTo: string | null; columns: string[]; rows: string[][] } | null> {
  if (!isUuid(id)) return null;
  const [r] = await db.select({ title: avecReports.title, fileName: avecReports.fileName, dateFrom: avecReports.dateFrom, dateTo: avecReports.dateTo, columns: avecReports.columns, rows: avecReports.rows })
    .from(avecReports).where(eq(avecReports.id, id));
  return r ?? null;
}
