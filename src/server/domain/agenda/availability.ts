import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { agendaBlocks, lists, professionals, professionalServices } from "../../db/schema";
import { UserFacingError } from "../errors";
import { getBusinessHours } from "../hours";
import { getAgendaRules } from "./mode";
import { loadOccupied, type OccupiedRow } from "./occupancy";
import { checkStart, freeSlots, type BlockItem, type BusyItem, type CheckResult, type DayRules } from "../../../lib/free-slots";
import { effectiveRanges, hmMin, type WorkHours } from "../../../lib/work-hours";
import { blockAppliesOn } from "../../../lib/agenda-blocks";
import { minuteOfDay, shiftDay, todayBahia } from "../../../lib/agenda";
import { bahiaParts } from "../../../lib/schedule";
import { firstName } from "../../../lib/authorship";
import { proDisplayName } from "../../../lib/slot-text";
import type { BusinessHours } from "../../../lib/business-hours";
import { isUuid } from "../../../lib/uuid";
import { isFuncaoOn } from "../funcoes";
import { proDurations } from "../service-terms";

export { OCCUPYING_STATUSES } from "./occupancy";

/**
 * Disponibilidade a partir do banco (spec §5.4, "Como o servidor monta o dia"): o dia de cada profissional para o motor puro
 * (src/lib/free-slots.ts) e as duas perguntas da agenda — "esse início pode?" (`checkStartFor`, usado ao marcar no 6B) e "quais os
 * próximos livres?" (`nextFreeSlots`, o Procurar horário). Faixas: o horário próprio ou o da Casa. Bloqueios: os que valem no dia, dela
 * ou de todas, sem os apagados. Ocupados: horários nos status que ocupam e leads antigos (agenda/occupancy.ts).
 */

const DAY_MS = 86_400_000;
const SEARCH_DAYS = 14, PER_PRO = 3;
/** No Procurar horário, ocupado nunca mostra o nome de outra cliente. */
const PRIVATE_LABEL = "outra cliente";
const midnightMs = (day: string) => Date.parse(`${day}T00:00:00-03:00`);

type ProRow = { id: string; name: string; workHours: WorkHours | null };
type BlockRow = { id: string; professionalId: string | null; title: string; startsOn: string; endsOn: string; startTime: string; endTime: string; weekdays: number[] | null; requestStatus: string | null };
/** `parallelOn`: a função "Serviço junto com outro" (0084) está ligada; desligada, o `parallelOk` dos serviços é ignorado (como antes). */
type Window = { pros: Map<string, ProRow>; casa: BusinessHours; blocks: BlockRow[]; busy: OccupiedRow[]; stepMin: number; parallelOn: boolean };

/** Tudo de uma vez para estas profissionais entre dois dias (com a véspera, para o horário que atravessa a meia-noite). */
async function loadWindow(tx: Tx | Db, o: { professionalIds: string[]; firstDay: string; lastDay: string; clientId?: string | null; ignoreAppointmentId?: string | null }): Promise<Window> {
  const ids = o.professionalIds.filter(isUuid);
  // Uma consulta de cada vez: o 6B chama dentro da transação que marca (uma conexão só).
  const pros = ids.length ? await tx.select({ id: professionals.id, name: professionals.name, workHours: professionals.workHours }).from(professionals).where(inArray(professionals.id, ids)) : [];
  const casa = await getBusinessHours(tx);
  const rules = await getAgendaRules(tx);
  const blocks = await tx.select({
      id: agendaBlocks.id, professionalId: agendaBlocks.professionalId, title: agendaBlocks.title, startsOn: agendaBlocks.startsOn, endsOn: agendaBlocks.endsOn,
      startTime: agendaBlocks.startTime, endTime: agendaBlocks.endTime, weekdays: agendaBlocks.weekdays, requestStatus: agendaBlocks.requestStatus,
    }).from(agendaBlocks).where(and(isNull(agendaBlocks.deletedAt), lte(agendaBlocks.startsOn, o.lastDay), gte(agendaBlocks.endsOn, o.firstDay),
      // Lote 7A: pedido de folga recusado não vale; o que está "pedido" só avisa (pending), o aprovado bloqueia.
      or(isNull(agendaBlocks.requestStatus), ne(agendaBlocks.requestStatus, "recusado")),
      ids.length ? or(isNull(agendaBlocks.professionalId), inArray(agendaBlocks.professionalId, ids)) : isNull(agendaBlocks.professionalId)));
  const busy = await loadOccupied(tx, {
    from: new Date(midnightMs(o.firstDay) - DAY_MS), to: new Date(midnightMs(shiftDay(o.lastDay, 1))),
    professionalIds: ids, contactId: o.clientId, ignoreAppointmentId: o.ignoreAppointmentId,
  });
  const parallelOn = await isFuncaoOn("junto_com_outro", tx);
  return { pros: new Map(pros.map((p) => [p.id, { ...p, workHours: p.workHours ?? null }])), casa, blocks, busy, stepMin: rules.passoMin, parallelOn };
}

/** O dia de uma profissional, em minutos de Salvador, a partir do que `loadWindow` trouxe. */
function buildDayRules(w: Window, professionalId: string, day: string, o: { clientId?: string | null; privacy?: boolean } = {}): DayRules & { name: string } {
  const pro = w.pros.get(professionalId);
  const blocks: BlockItem[] = w.blocks
    .filter((b) => (b.professionalId === null || b.professionalId === professionalId) && blockAppliesOn(b, day))
    .flatMap((b) => {
      const start = hmMin(b.startTime), end = hmMin(b.endTime);
      return start != null && end != null && end > start ? [{ id: b.id, title: b.title, start, end, ...(b.requestStatus === "pedido" ? { pending: true } : {}) }] : [];
    });
  const dayStart = midnightMs(day);
  const busy: BusyItem[] = [];
  for (const r of w.busy) {
    const mine = r.professionalId === professionalId;
    if (!mine && !(o.clientId && r.contactId === o.clientId)) continue;
    const start = Math.round((r.startsAt.getTime() - dayStart) / 60_000);
    const unknown = r.durationMin == null;
    // Sem duração no horário nem no serviço: ocupa um passo (regra 5) e o motor avisa.
    const len = unknown ? w.stepMin : r.durationMin!;
    const end = start + len + (unknown ? 0 : r.bufferMin);
    if (end <= 0 || start >= 1440) continue;
    const label = o.privacy ? PRIVATE_LABEL : `${firstName(r.clientName) ?? r.clientName}${r.serviceLabel ? ` · ${r.serviceLabel}` : ""}`;
    busy.push({
      id: r.id, label, start: Math.max(0, start), end: Math.min(1440, end), clientEnd: Math.min(1440, start + len), clientId: r.contactId,
      ...(unknown ? { unknownDuration: true } : {}), ...(mine ? {} : { otherPro: true }), ...(w.parallelOn && r.parallelOk === true ? { parallelOk: true } : {}),
    });
  }
  return { ranges: effectiveRanges(day, pro?.workHours ?? null, w.casa), blocks, busy, name: proDisplayName(pro?.name ?? "") };
}

/**
 * O dia de uma profissional para o motor. `clientId` traz também os horários dessa cliente com outras profissionais (conflito de
 * cliente); `ignoreAppointmentId` tira o horário que está sendo remarcado; `privacy` troca o nome das clientes por "outra cliente".
 */
export async function dayRulesFor(o: { professionalId: string; day: string; clientId?: string | null; ignoreAppointmentId?: string | null; privacy?: boolean }, tx: Tx | Db = db): Promise<DayRules & { name: string }> {
  const w = await loadWindow(tx, { professionalIds: [o.professionalId], firstDay: o.day, lastDay: o.day, clientId: o.clientId, ignoreAppointmentId: o.ignoreAppointmentId });
  return buildDayRules(w, o.professionalId, o.day, o);
}

/**
 * "Esse início pode?" para uma profissional: relê o banco e roda o motor. Duração e folga: as que vierem, senão as do serviço (vazia =
 * `sem_duracao`). Hoje vale a partir de 15 min atrás; dia que já passou = `passou`.
 */
export async function checkStartFor(input: {
  professionalId: string; startsAt: Date; serviceId?: string | null; durationMin?: number | null; bufferMin?: number | null; clientId?: string | null;
  ignoreAppointmentId?: string | null; allowFitIn?: boolean; allowOutsideHours?: boolean; now?: Date; parallelOk?: boolean | null;
}, tx: Tx | Db = db): Promise<CheckResult> {
  let { durationMin, bufferMin } = input;
  if (input.serviceId && (durationMin === undefined || bufferMin === undefined)) {
    const [s] = isUuid(input.serviceId) ? await tx.select({ d: lists.durationMin, b: lists.bufferMin }).from(lists).where(eq(lists.id, input.serviceId)) : [];
    if (durationMin === undefined) durationMin = s?.d ?? null;
    if (bufferMin === undefined) bufferMin = s?.b ?? null;
  }
  const day = bahiaParts(input.startsAt.getTime()).date;
  const now = input.now ?? new Date(), today = todayBahia(now);
  const w = await loadWindow(tx, { professionalIds: [input.professionalId], firstDay: day, lastDay: day, clientId: input.clientId, ignoreAppointmentId: input.ignoreAppointmentId });
  return checkStart(buildDayRules(w, input.professionalId, day, { clientId: input.clientId }), minuteOfDay(input.startsAt), {
    durationMin: durationMin ?? null, bufferMin, stepMin: w.stepMin, clientId: input.clientId, allowFitIn: input.allowFitIn, allowOutsideHours: input.allowOutsideHours, parallelOk: input.parallelOk,
    notBeforeMin: day < today ? 1441 : day === today ? minuteOfDay(now) - 15 : null,
  });
}

export type NextFree =
  | { ok: false; reason: "sem_duracao" | "ninguem_faz"; service: { id: string; label: string }; professionalName?: string }
  | {
      ok: true; service: { id: string; label: string; durationMin: number; bufferMin: number }; stepMin: number;
      pros: { id: string; name: string; color: string | null; slots: { day: string; start: number; warnings: string[] }[] }[];
    };

/**
 * Procurar horário: para cada profissional ATIVA que faz o serviço (ou só a escolhida), os 3 próximos horários livres em até 14 dias,
 * a partir de agora. Só apelido, horário e avisos: nunca o nome de outra cliente. Serviço sem duração não tem sugestão (nunca chuta).
 */
export async function nextFreeSlots(o: { serviceId: string; professionalId?: string | null; now?: Date }, tx: Tx | Db = db): Promise<NextFree> {
  const [service] = isUuid(o.serviceId)
    ? await tx.select({ id: lists.id, label: lists.label, kind: lists.kind, durationMin: lists.durationMin, bufferMin: lists.bufferMin }).from(lists).where(eq(lists.id, o.serviceId))
    : [];
  if (!service || service.kind !== "service") throw new UserFacingError("Serviço não encontrado.");
  const svc = { id: service.id, label: service.label };
  if (!service.durationMin || service.durationMin <= 0) return { ok: false, reason: "sem_duracao", service: svc };
  const doers = await tx.select({ id: professionals.id, name: professionals.name, color: professionals.color }).from(professionals)
    .innerJoin(professionalServices, eq(professionalServices.professionalId, professionals.id))
    .where(and(eq(professionalServices.serviceId, service.id), eq(professionals.active, true)))
    .orderBy(sql`${professionals.agendaPosition} asc nulls last`, asc(professionals.name));
  const pros = o.professionalId ? doers.filter((p) => p.id === o.professionalId) : doers;
  if (!pros.length) {
    const [p] = o.professionalId && isUuid(o.professionalId) ? await tx.select({ name: professionals.name }).from(professionals).where(eq(professionals.id, o.professionalId)) : [];
    return { ok: false, reason: "ninguem_faz", service: svc, ...(p ? { professionalName: proDisplayName(p.name) } : {}) };
  }
  const now = o.now ?? new Date(), today = todayBahia(now), nowMin = minuteOfDay(now);
  const w = await loadWindow(tx, { professionalIds: pros.map((p) => p.id), firstDay: today, lastDay: shiftDay(today, SEARCH_DAYS - 1) });
  const bufferMin = Math.max(0, service.bufferMin ?? 0);
  // 0084: cada profissional com o tempo dela (o próprio, senão o do serviço).
  const own = await proDurations(tx, service.id, pros.map((p) => p.id));
  return {
    ok: true, service: { ...svc, durationMin: service.durationMin, bufferMin }, stepMin: w.stepMin,
    pros: pros.map((p) => {
      const slots: { day: string; start: number; warnings: string[] }[] = [];
      for (let i = 0; i < SEARCH_DAYS && slots.length < PER_PRO; i++) {
        const day = shiftDay(today, i);
        const r = freeSlots(buildDayRules(w, p.id, day, { privacy: true }), { durationMin: own.get(p.id) ?? service.durationMin, bufferMin, stepMin: w.stepMin, notBeforeMin: i === 0 ? nowMin : null });
        if (r.ok) for (const s of r.slots.slice(0, PER_PRO - slots.length)) slots.push({ day, start: s.start, warnings: s.warnings });
      }
      return { id: p.id, name: proDisplayName(p.name), color: p.color, slots };
    }),
  };
}

/**
 * Os inícios LIVRES (sem encaixe, dentro do horário, sem bloqueio/folga aprovada) de cada profissional em cada dia pedido, em minutos
 * de Salvador. Uma leitura só do banco para todos os dias (a sugestão por IA usa para oferecer horários). Hoje: só a partir de agora.
 * `durationByPro` (0084): o tempo próprio de quem tem; as outras usam `durationMin`.
 */
export async function freeStartsByDay(o: { professionalIds: string[]; days: string[]; durationMin: number; durationByPro?: Map<string, number>; bufferMin: number | null; clientId?: string | null; now: Date }, tx: Tx | Db = db): Promise<Map<string, Map<string, number[]>>> {
  const out = new Map<string, Map<string, number[]>>();
  if (!o.days.length || !o.professionalIds.length) return out;
  const sorted = [...o.days].sort();
  const w = await loadWindow(tx, { professionalIds: o.professionalIds, firstDay: sorted[0], lastDay: sorted.at(-1)!, clientId: o.clientId });
  const today = todayBahia(o.now), nowMin = minuteOfDay(o.now);
  for (const day of o.days) {
    const m = new Map<string, number[]>();
    if (day >= today) for (const id of o.professionalIds) {
      const r = freeSlots(buildDayRules(w, id, day, { clientId: o.clientId, privacy: true }), {
        durationMin: o.durationByPro?.get(id) ?? o.durationMin, bufferMin: o.bufferMin, stepMin: w.stepMin, clientId: o.clientId, notBeforeMin: day === today ? nowMin : null,
      });
      m.set(id, r.ok ? r.slots.filter((s) => s.kind === "livre" && !s.warnings.length).map((s) => s.start) : []);
    }
    out.set(day, m);
  }
  return out;
}
