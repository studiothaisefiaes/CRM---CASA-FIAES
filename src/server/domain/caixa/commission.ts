import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "../../db";
import { auditLog, comandaItemAssistants, comandaItems, comandas, commissionPayouts, lists, professionals, professionalServices } from "../../db/schema";
import type { Deductions } from "@/lib/commission-math";
import { readProCommissionRules, type ProCommissionRules } from "@/lib/commission-rules";
import type { Actor } from "../agenda/actor";
import { UserFacingError } from "../errors";

/**
 * Comissão (7.1, 7.4 regra 7): o % fica em `professional_services.commission_bp` (vazio = sem regra) e é congelado no item ao fechar a
 * comanda. Relatório lê só o retrato. Editar regra e ver o relatório não dependem do modo do caixa (a Casa prepara antes).
 */
const validBp = (bp: number | null) => bp === null || (Number.isInteger(bp) && bp >= 0 && bp <= 10000);

export async function setCommission(input: { professionalId: string; serviceId: string; bp: number | null }, actor: Actor): Promise<void> {
  if (!validBp(input.bp)) throw new UserFacingError("Use de 0% a 100%.");
  await db.transaction(async (tx) => {
    const where = and(eq(professionalServices.professionalId, input.professionalId), eq(professionalServices.serviceId, input.serviceId));
    const [row] = await tx.select().from(professionalServices).where(where).for("update");
    if (!row) throw new UserFacingError("Ela não faz esse serviço: marque em Profissionais primeiro.");
    if (row.commissionBp === input.bp) return;
    await tx.update(professionalServices).set({ commissionBp: input.bp }).where(where);
    await tx.insert(auditLog).values({ userId: actor.id, action: "comissao_regra", entity: "professional", entityId: input.professionalId, data: { servico: input.serviceId, de: row.commissionBp, para: input.bp } });
  });
}

/** "Aplicar à categoria": o mesmo % em todos os serviços daquela categoria que ela faz. */
export async function applyCommissionToCategory(input: { professionalId: string; category: string; bp: number | null }, actor: Actor): Promise<{ updated: number }> {
  if (!validBp(input.bp)) throw new UserFacingError("Use de 0% a 100%.");
  return db.transaction(async (tx) => {
    const ids = (await tx.select({ id: professionalServices.serviceId }).from(professionalServices).innerJoin(lists, eq(lists.id, professionalServices.serviceId))
      .where(and(eq(professionalServices.professionalId, input.professionalId), eq(lists.category, input.category)))).map((r) => r.id);
    if (!ids.length) throw new UserFacingError(`Ela não faz nenhum serviço de ${input.category}.`);
    await tx.update(professionalServices).set({ commissionBp: input.bp }).where(and(eq(professionalServices.professionalId, input.professionalId), inArray(professionalServices.serviceId, ids)));
    await tx.insert(auditLog).values({ userId: actor.id, action: "comissao_regra", entity: "professional", entityId: input.professionalId, data: { categoria: input.category, servicos: ids.length, para: input.bp } });
    return { updated: ids.length };
  });
}

export type CommissionRuleRow = {
  professionalId: string; name: string; active: boolean;
  /** Regra própria da profissional (cartão, antecipação, custo); null = segue a Casa. */
  rules: ProCommissionRules | null;
  services: { serviceId: string; label: string; category: string | null; bp: number | null; assistantBp: number | null }[];
};

/** Caixa › Comissão › Regras: cada profissional com os serviços que faz e o % de cada um. */
export async function listCommissionRules(): Promise<CommissionRuleRow[]> {
  const rows = await db.select({ pro: professionals.id, name: professionals.name, active: professionals.active, serviceId: lists.id, label: lists.label, category: lists.category, bp: professionalServices.commissionBp, assistantBp: professionalServices.assistantBp, rules: professionals.commissionRules })
    .from(professionalServices).innerJoin(professionals, eq(professionals.id, professionalServices.professionalId)).innerJoin(lists, eq(lists.id, professionalServices.serviceId))
    .orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name), asc(lists.category), asc(lists.label));
  const out: CommissionRuleRow[] = [];
  for (const r of rows) {
    let row = out.find((x) => x.professionalId === r.pro);
    if (!row) out.push(row = { professionalId: r.pro, name: r.name, active: r.active, services: [], rules: readProCommissionRules(r.rules) });
    row.services.push({ serviceId: r.serviceId, label: r.label, category: r.category, bp: r.bp, assistantBp: r.assistantBp });
  }
  return out;
}

export type CommissionStatus = "ok" | "sem_regra" | "sem_valor_sessao" | "aguardando_quitacao";
export type CommissionLine = {
  /** O item da comanda (na linha da assistente também; `assistantId` é a linha dela em comanda_item_assistants). */
  itemId: string; assistantId: string | null; day: string; comandaNumber: number; clientName: string; label: string; kind: string;
  role: "principal" | "assistente";
  /** Na linha da assistente: o nome da principal ("Corte (assistente de Ana)"). */
  principalName: string | null;
  baseCents: number | null; bp: number | null; commissionCents: number | null; status: CommissionStatus;
  /** Retrato da Fase A (só na linha da principal): a comissão sem descontos e cada desconto aplicado. */
  grossCents: number | null; deductions: Deductions | null;
  /** O recibo que pagou esta linha (Tarefa 9); vazio = ainda não paga. */
  payoutNumber: number | null; payoutId: string | null;
};
/**
 * `pending`: linhas sem regra ou sessão sem valor (a gestão preenche). `held`: retidas até a cliente quitar a dívida da comanda (Fase A,
 * item 6; entram sozinhas quando ela paga). As duas à parte, nunca somadas.
 */
export type CommissionReport = {
  from: string; to: string; pending: number; held: number;
  rows: { professionalId: string; name: string; active: boolean; lines: CommissionLine[]; baseCents: number; commissionCents: number; pending: number; held: number }[];
};

const statusOf = (o: { kind: string; base: number | null; bp: number | null; held: boolean }): CommissionStatus =>
  o.held ? "aguardando_quitacao" : o.kind === "pacote_sessao" && o.base == null ? "sem_valor_sessao" : o.bp == null ? "sem_regra" : "ok";

/**
 * Relatório Comissão por período (comandas fechadas, itens vivos de serviço e sessão de pacote). Pendências à parte, nunca somadas.
 * A assistente aparece na profissional dela, numa linha "{serviço} (assistente de {principal})", com a base, o % e a comissão do retrato.
 */
export async function commissionReport(o: { from: string; to: string; professionalId?: string | null }): Promise<CommissionReport> {
  const period = and(eq(comandas.status, "fechada"), gte(comandas.day, o.from), lte(comandas.day, o.to), isNull(comandaItems.cancelledAt), inArray(comandaItems.kind, ["servico", "pacote_sessao"]));
  const principal = alias(professionals, "principal");
  // O instante do item com microssegundos (o Date do JS para no milissegundo: itens somados no mesmo ms empatavam e a ordem vinha da tabela).
  const itemAt = sql<string>`to_char(${comandaItems.createdAt} at time zone 'UTC', 'YYYYMMDDHH24MISSUS')`;
  const [mains, helpers] = await Promise.all([
    db.select({
      itemId: comandaItems.id, day: comandas.day, number: comandas.number, clientName: comandas.clientName, label: comandaItems.label, kind: comandaItems.kind, at: itemAt,
      base: comandaItems.commissionBaseCents, bp: comandaItems.commissionBp, value: comandaItems.commissionCents, gross: comandaItems.commissionGrossCents, deductions: comandaItems.commissionDeductions,
      held: comandaItems.commissionHeld, payout: commissionPayouts.number, payoutId: comandaItems.payoutId, pro: professionals.id, name: professionals.name, active: professionals.active, position: professionals.agendaPosition,
    }).from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId)).innerJoin(professionals, eq(professionals.id, comandaItems.professionalId))
      .leftJoin(commissionPayouts, eq(commissionPayouts.id, comandaItems.payoutId))
      .where(and(period, o.professionalId ? eq(comandaItems.professionalId, o.professionalId) : undefined)),
    db.select({
      assistantId: comandaItemAssistants.id, itemId: comandaItems.id, day: comandas.day, number: comandas.number, clientName: comandas.clientName, label: comandaItems.label, kind: comandaItems.kind,
      at: itemAt, base: comandaItemAssistants.baseCents, bp: comandaItemAssistants.bp, value: comandaItemAssistants.commissionCents, held: comandaItems.commissionHeld,
      payout: commissionPayouts.number, payoutId: comandaItemAssistants.payoutId, pro: professionals.id, name: professionals.name, active: professionals.active, position: professionals.agendaPosition, principalName: principal.name,
    }).from(comandaItemAssistants).innerJoin(comandaItems, eq(comandaItems.id, comandaItemAssistants.comandaItemId)).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
      .innerJoin(professionals, eq(professionals.id, comandaItemAssistants.professionalId)).leftJoin(principal, eq(principal.id, comandaItems.professionalId))
      .leftJoin(commissionPayouts, eq(commissionPayouts.id, comandaItemAssistants.payoutId))
      // Assistente ignorada no Finalizar ("Assistente na comanda" desligado) fica sem base: não é linha. Com o recurso ligado a base dela
      // sempre é gravada, exceto na sessão de pacote sem valor (aí o item também fica sem base e a linha segue "valor da sessão não definido").
      .where(and(period, or(isNotNull(comandaItemAssistants.baseCents), isNull(comandaItems.commissionBaseCents)),
        o.professionalId ? eq(comandaItemAssistants.professionalId, o.professionalId) : undefined)),
  ]);
  type Entry = { pro: string; name: string; active: boolean; position: number | null; day: string; number: number; at: string; line: CommissionLine };
  const entries: Entry[] = [
    ...mains.map((r): Entry => ({ ...r, line: {
      itemId: r.itemId, assistantId: null, day: r.day, comandaNumber: r.number, clientName: r.clientName ?? "Cliente", label: r.label, kind: r.kind, role: "principal", principalName: null,
      baseCents: r.base, bp: r.bp, commissionCents: r.value, status: statusOf(r), grossCents: r.gross, deductions: r.deductions ?? null, payoutNumber: r.payout ?? null, payoutId: r.payoutId ?? null,
    } })),
    ...helpers.map((r): Entry => ({ ...r, line: {
      itemId: r.itemId, assistantId: r.assistantId, day: r.day, comandaNumber: r.number, clientName: r.clientName ?? "Cliente", label: `${r.label} (assistente de ${r.principalName ?? "outra profissional"})`,
      kind: r.kind, role: "assistente", principalName: r.principalName ?? null, baseCents: r.base, bp: r.bp, commissionCents: r.value, status: statusOf(r),
      grossCents: null, deductions: null, payoutNumber: r.payout ?? null, payoutId: r.payoutId ?? null,
    } })),
  ];
  // Profissionais pela ordem da agenda (vazio por último) e nome; dentro dela, por dia, número da comanda e ordem do item.
  const cmp = (a: Entry, b: Entry) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.name.localeCompare(b.name, "pt-BR") || a.pro.localeCompare(b.pro)
    || a.day.localeCompare(b.day) || a.number - b.number || a.at.localeCompare(b.at) || a.line.itemId.localeCompare(b.line.itemId) || (a.line.role === b.line.role ? 0 : a.line.role === "principal" ? -1 : 1);
  const report: CommissionReport = { from: o.from, to: o.to, pending: 0, held: 0, rows: [] };
  for (const e of entries.sort(cmp)) {
    let row = report.rows.find((x) => x.professionalId === e.pro);
    if (!row) report.rows.push(row = { professionalId: e.pro, name: e.name, active: e.active, lines: [], baseCents: 0, commissionCents: 0, pending: 0, held: 0 });
    row.lines.push(e.line);
    if (e.line.status === "ok") { row.baseCents += e.line.baseCents ?? 0; row.commissionCents += e.line.commissionCents ?? 0; }
    else if (e.line.status === "aguardando_quitacao") { row.held++; report.held++; } else { row.pending++; report.pending++; }
  }
  return report;
}
