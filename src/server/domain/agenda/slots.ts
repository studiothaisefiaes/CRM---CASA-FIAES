import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db, type Tx } from "../../db";
import { appointments, contacts, lists, professionals, professionalServices } from "../../db/schema";
import { checkStart, freeSlots, pickAny, type DayRules, type SlotKind } from "@/lib/free-slots";
import { dayOf, hmToMinutes, instantOf, minuteOfDay, todayBahia } from "@/lib/agenda";
import { OCCUPYING_STATUSES, START_GRACE_MIN } from "@/lib/appointment-status";
import { conflictText, refusalText, type ConflictDetail, type SlotRefusal } from "@/lib/agenda-text";
import { firstName } from "@/lib/authorship";
import { isUuid } from "@/lib/uuid";
import { teamNameOf } from "../../queries/team-name";
import { dayRulesFor } from "./availability";
import { getAgendaRules } from "./mode";
import { proDurations } from "../service-terms";

/**
 * O único lugar do 6B que fala com o motor do 6A (`dayRulesFor`, `checkStart`, `freeSlots`, `pickAny`). Converte instante ↔ minuto do dia
 * em Salvador, aplica os 15 min de tolerância (6.4, regra 8) e devolve os conflitos com nome, serviço e quem marcou. Uma consulta de
 * cada vez: pode estar dentro da transação que marca.
 */
type Q = Tx | typeof db;

export type SlotCheckInput = {
  professionalId: string; startsAt: Date; durationMin: number | null; bufferMin: number | null;
  clientId: string | null; ignoreAppointmentId?: string | null; now: Date;
  /** o serviço "pode ser feito junto com outro" (0084); só vale com a função ligada (o dia já vem sem `parallelOk` se desligada) */ parallelOk?: boolean | null;
};
export type SlotCheckResult =
  | { ok: true; kind: SlotKind; fitIn: boolean; outsideHours: boolean; warnings: string[]; conflicts: ConflictDetail[] }
  | { ok: false; reason: SlotRefusal; conflicts: ConflictDetail[]; blockedBy?: string };

/** Hoje: a partir de 15 min atrás. Outro dia (futuro): sem limite. Dia que já passou é recusado antes. */
export const notBeforeMin = (day: string, now: Date): number | null => (day === todayBahia(now) ? minuteOfDay(now) - START_GRACE_MIN : null);

async function conflictDetails(q: Q, day: string, list: { id: string; label: string }[], clientId: string | null, rules: DayRules): Promise<ConflictDetail[]> {
  if (!list.length) return [];
  const busy = new Map(rules.busy.map((b) => [b.id, b]));
  const ids = list.map((c) => c.id).filter(isUuid);
  const rows = ids.length
    ? await q.select({
        id: appointments.id, contactId: appointments.contactId, clientName: appointments.clientName, contactName: contacts.name, serviceLabel: appointments.serviceLabel,
        professionalName: professionals.name, startsAt: appointments.startsAt, createdAt: appointments.createdAt, createdByName: teamNameOf(appointments.createdBy),
      }).from(appointments).leftJoin(contacts, eq(contacts.id, appointments.contactId)).leftJoin(professionals, eq(professionals.id, appointments.professionalId))
        .where(inArray(appointments.id, ids))
    : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return list.map((c) => {
    const b = busy.get(c.id), r = byId.get(c.id);
    const [labelName, labelService] = c.label.split(" · ");
    const start = b?.start ?? (r ? minuteOfDay(r.startsAt) : 0);
    return {
      id: c.id, clientName: r?.contactName?.trim() || r?.clientName?.trim() || labelName || "Cliente", serviceLabel: r?.serviceLabel ?? labelService ?? "",
      professionalName: r?.professionalName ?? null, startsAt: instantOf(day, start).toISOString(), endsAt: instantOf(day, b?.end ?? start + 30).toISOString(),
      sameClient: !!clientId && (b?.clientId === clientId || r?.contactId === clientId) && !!b?.otherPro,
      createdByName: r?.createdByName ?? null, createdAt: r?.createdAt?.toISOString() ?? null,
    };
  });
}

/**
 * Confere um horário candidato relendo o banco (chame depois de `lockAgendaTx`). Pede ao motor com encaixe e fora do horário liberados,
 * para sempre devolver o que atrapalha; quem decide se pode encaixar é quem chama (`fitIn`/`outsideHours`).
 */
export async function checkSlotTx(q: Q, i: SlotCheckInput): Promise<SlotCheckResult> {
  const day = dayOf(i.startsAt);
  if (day < todayBahia(i.now)) return { ok: false, reason: "passou", conflicts: [] };
  const rules = await dayRulesFor({ professionalId: i.professionalId, day, clientId: i.clientId, ignoreAppointmentId: i.ignoreAppointmentId ?? null }, q);
  const { passoMin } = await getAgendaRules(q);
  const start = minuteOfDay(i.startsAt);
  const r = checkStart(rules, start, {
    durationMin: i.durationMin, bufferMin: i.bufferMin, stepMin: passoMin, notBeforeMin: notBeforeMin(day, i.now), clientId: i.clientId, allowFitIn: true, allowOutsideHours: true,
    parallelOk: i.parallelOk,
  });
  const conflicts = await conflictDetails(q, day, r.conflicts, i.clientId, rules);
  if (!r.ok) return { ok: false, reason: r.reason, conflicts, blockedBy: r.blockedBy };
  const end = start + (i.durationMin ?? 0) + Math.max(0, i.bufferMin ?? 0);
  const outsideHours = !rules.ranges.some(([a, b]) => start >= a && end <= b);
  return { ok: true, kind: r.kind, fitIn: r.conflicts.length > 0, outsideHours, warnings: r.warnings, conflicts };
}

/** Profissionais ativas que fazem o serviço (ou só `onlyId`), na ordem da agenda. */
export async function prosForService(q: Q, serviceId: string, onlyId: string | null = null) {
  return q.select({ id: professionals.id, name: professionals.name, position: professionals.agendaPosition })
    .from(professionalServices).innerJoin(professionals, eq(professionals.id, professionalServices.professionalId))
    .where(and(eq(professionalServices.serviceId, serviceId), eq(professionals.active, true), onlyId ? eq(professionals.id, onlyId) : undefined))
    .orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name));
}

/** Quantos horários (que ocupam) cada profissional tem no dia: o critério do "Qualquer uma" (`pickAny`). */
export async function proDayCounts(q: Q, ids: string[], day: string): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows = await q.select({ id: appointments.professionalId, n: sql<number>`count(*)::int` }).from(appointments)
    .where(and(inArray(appointments.professionalId, ids), gte(appointments.startsAt, instantOf(day, 0)), lt(appointments.startsAt, instantOf(day, 1440)),
      inArray(appointments.status, [...OCCUPYING_STATUSES]), isNull(appointments.avecTwinOf)))
    .groupBy(appointments.professionalId);
  return new Map(rows.map((r) => [r.id!, r.n]));
}

/** Os `n` inícios mais perto de `around` (primeiro os de depois, completando com os de antes), devolvidos em ordem. */
export function nearest(starts: number[], around: number | null, n: number): number[] {
  if (around == null) return starts.slice(0, n);
  const pick = starts.filter((s) => s >= around).slice(0, n);
  for (const b of starts.filter((s) => s < around).reverse()) { if (pick.length >= n) break; pick.push(b); }
  return pick.sort((a, b) => a - b);
}

/** Até `limit` horários livres no dia para cada profissional (só os que cabem sem encaixe e no horário de trabalho). */
export async function daySuggestions(q: Q, i: {
  professionalIds: string[]; day: string; durationMin: number; bufferMin: number | null; clientId: string | null; aroundMin: number | null;
  ignoreAppointmentId?: string | null; now: Date; limit?: number; parallelOk?: boolean | null;
}): Promise<{ professionalId: string; startsAt: string[] }[]> {
  if (i.day < todayBahia(i.now)) return [];
  const { passoMin } = await getAgendaRules(q);
  const out: { professionalId: string; startsAt: string[] }[] = [];
  for (const professionalId of i.professionalIds) {
    const rules = await dayRulesFor({ professionalId, day: i.day, clientId: i.clientId, ignoreAppointmentId: i.ignoreAppointmentId ?? null }, q);
    const r = freeSlots(rules, { durationMin: i.durationMin, bufferMin: i.bufferMin, stepMin: passoMin, notBeforeMin: notBeforeMin(i.day, i.now), clientId: i.clientId, parallelOk: i.parallelOk });
    const livres = r.ok ? r.slots.filter((x) => x.kind === "livre").map((x) => x.start) : [];
    out.push({ professionalId, startsAt: nearest(livres, i.aroundMin, i.limit ?? 3).map((m) => instantOf(i.day, m).toISOString()) });
  }
  return out;
}

export type FreeSlotsQuery = {
  serviceId: string; professionalId: string | null; day: string; time: string | null;
  durationMin?: number | null; clientId?: string | null; ignoreAppointmentId?: string | null; linkService?: boolean;
};
export type SlotPreview = { state: "livre" | "encaixe" | "fora_do_horario" | "recusado"; text: string; warnings: string[]; professionalId: string | null };
export type FreeSlotsResult = {
  serviceLabel: string; durationMin: number | null; needsDuration: boolean; nobody: boolean;
  preview: SlotPreview | null; suggestions: { professionalId: string; name: string; startsAt: string[] }[];
};

const kindOf = (r: SlotCheckResult): SlotKind | null => (r.ok ? (r.outsideHours ? "fora_do_horario" : r.fitIn ? "encaixe" : "livre") : null);

function toPreview(r: SlotCheckResult, proName: string, serviceLabel: string, professionalId: string): SlotPreview {
  if (!r.ok) {
    const text = r.reason === "conflito" && r.conflicts[0] ? conflictText(proName, r.conflicts[0]) : refusalText(r.reason, { proName, serviceLabel, blockedBy: r.blockedBy });
    return { state: "recusado", text, warnings: [], professionalId };
  }
  if (r.fitIn) return { state: "encaixe", text: r.conflicts[0] ? conflictText(proName, r.conflicts[0]) : refusalText("conflito", { proName, serviceLabel }), warnings: r.warnings, professionalId };
  if (r.outsideHours) return { state: "fora_do_horario", text: refusalText("fora_do_horario", { proName, serviceLabel }), warnings: r.warnings, professionalId };
  return { state: "livre", text: "Livre", warnings: r.warnings, professionalId };
}

/**
 * A prévia do formulário Marcar (só lê): o horário escolhido ("Livre" ou o conflito exato) e os próximos livres do dia. 0084: cada
 * profissional é conferida com o tempo dela (o próprio, senão o do serviço), como ao marcar.
 */
export async function previewBooking(i: FreeSlotsQuery, now: Date): Promise<FreeSlotsResult> {
  const [svc] = await db.select({ label: lists.label, durationMin: lists.durationMin, bufferMin: lists.bufferMin, parallelOk: lists.parallelOk }).from(lists)
    .where(and(eq(lists.id, i.serviceId), eq(lists.kind, "service")));
  if (!svc) return { serviceLabel: "", durationMin: null, needsDuration: false, nobody: false, suggestions: [],
    preview: { state: "recusado", text: "Esse serviço não está mais na lista. Escolha outro.", warnings: [], professionalId: null } };
  const durationMin = svc.durationMin ?? i.durationMin ?? null;
  const pros = i.linkService && i.professionalId
    ? await db.select({ id: professionals.id, name: professionals.name, position: professionals.agendaPosition }).from(professionals).where(and(eq(professionals.id, i.professionalId), eq(professionals.active, true)))
    : await prosForService(db, i.serviceId, i.professionalId);
  // 0084: o tempo próprio de cada profissional (sem ele, o do serviço ou o digitado).
  const own = await proDurations(db, i.serviceId, pros.map((p) => p.id));
  const durOf = new Map(pros.flatMap((p) => { const d = own.get(p.id) ?? durationMin; return d != null ? [[p.id, d] as const] : []; }));
  const base = {
    serviceLabel: svc.label, durationMin: (i.professionalId ? own.get(i.professionalId) : undefined) ?? durationMin,
    // "Qualquer uma" continua pedindo a duração (como ao marcar): só a profissional escolhida com tempo próprio dispensa.
    needsDuration: svc.durationMin == null && !(i.professionalId && own.has(i.professionalId)), nobody: !pros.length,
  };
  if (!pros.length) {
    const text = i.professionalId ? "Essa profissional não faz esse serviço." : `Ninguém está marcado para fazer ${svc.label}. Marque em Configurações › Profissionais.`;
    return { ...base, suggestions: [], preview: { state: "recusado", text, warnings: [], professionalId: null } };
  }
  if (base.needsDuration && durationMin == null) return { ...base, preview: null, suggestions: [] };
  const names = new Map(pros.map((p) => [p.id, p.name]));
  const at = hmToMinutes(i.time);
  let preview: SlotPreview | null = null;
  if (at != null) {
    const checks = new Map<string, SlotCheckResult>();
    for (const p of pros) checks.set(p.id, await checkSlotTx(db, { professionalId: p.id, startsAt: instantOf(i.day, at), durationMin: durOf.get(p.id)!, bufferMin: svc.bufferMin, clientId: i.clientId ?? null, ignoreAppointmentId: i.ignoreAppointmentId ?? null, now, parallelOk: svc.parallelOk }));
    if (i.professionalId) preview = toPreview(checks.get(i.professionalId)!, names.get(i.professionalId) ?? "A profissional", svc.label, i.professionalId);
    else {
      const counts = await proDayCounts(db, pros.map((p) => p.id), i.day);
      const pick = pickAny(pros.map((p) => ({ id: p.id, name: p.name, position: p.position, dayCount: counts.get(p.id) ?? 0, kind: kindOf(checks.get(p.id)!) })));
      const chosen = pick ? checks.get(pick) : null;
      preview = pick && chosen?.ok
        ? { state: "livre", text: `Livre com a ${firstName(names.get(pick)) ?? names.get(pick)}`, warnings: chosen.warnings, professionalId: pick }
        : { state: "recusado", text: `Ninguém que faz ${svc.label} está livre às ${i.time}.`, warnings: [], professionalId: null };
    }
  }
  const sug: { professionalId: string; startsAt: string[] }[] = [];
  for (const p of pros) sug.push(...await daySuggestions(db, { professionalIds: [p.id], day: i.day, durationMin: durOf.get(p.id)!, bufferMin: svc.bufferMin, clientId: i.clientId ?? null, aroundMin: at, ignoreAppointmentId: i.ignoreAppointmentId ?? null, now, parallelOk: svc.parallelOk }));
  return { ...base, preview, suggestions: sug.filter((x) => x.startsAt.length).map((x) => ({ ...x, name: names.get(x.professionalId) ?? "" })) };
}
