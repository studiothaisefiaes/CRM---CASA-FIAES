/**
 * O motor de horários livres (spec §5.4). Função pura: trabalha só com MINUTOS DO DIA EM SALVADOR (0 a 1440) e nunca com `Date`,
 * por isso não sente fuso, horário de verão nem relógio do aparelho. Quem chama converte com `bahiaParts`, `slotMs` e `minuteOfDay`
 * e monta o dia de cada profissional (`dayRulesFor`, src/server/domain/agenda/availability.ts).
 *
 * Regras: a ocupação de um candidato é [início, início + duração + folga) — a folga só pesa para a profissional; intervalos fechados no
 * início e abertos no fim (terminar 11:00 e começar 11:00 não sobrepõe); bloqueio recusa sempre; pedido de folga pendente só avisa;
 * conflito com a mesma profissional ou com a mesma cliente (em qualquer profissional) só volta como encaixe — menos o da mesma cliente com
 * outra profissional quando os DOIS serviços "podem ser feitos junto com outro" (`parallelOk`, 0084); fora das faixas do dia só volta como
 * "fora do horário"; duração vazia nunca vira 60 min.
 */
export type Interval = { start: number; end: number };
/**
 * Horário que já ocupa a agenda. `end` já traz a folga dele. `unknownDuration`: sem duração no horário nem no serviço — quem monta o
 * dia põe um passo da grade em `end` e o motor só avisa. `otherPro`: horário da mesma cliente com OUTRA profissional, que só conta
 * para o conflito de cliente, e então até `clientEnd` (sem a folga). `parallelOk`: o serviço dele "pode ser feito junto com outro" (0084).
 */
export type BusyItem = Interval & {
  id: string; label: string; unknownDuration?: boolean; fitIn?: boolean; clientId?: string | null; clientEnd?: number; otherPro?: boolean; parallelOk?: boolean;
};
/** Bloqueio que vale no dia; `pending` = pedido de folga ainda não aprovado (7A): só avisa. */
export type BlockItem = Interval & { id: string; title: string; pending?: boolean };
/** O dia de UMA profissional: faixas de trabalho, bloqueios e ocupados. `name` (apelido) entra nos avisos. */
export type DayRules = { ranges: [number, number][]; blocks: BlockItem[]; busy: BusyItem[]; name?: string };

export type SlotQuery = {
  /** null → { ok:false, reason:"sem_duracao" } (nunca chutar) */ durationMin: number | null;
  /** folga depois; vazio = 0 */ bufferMin?: number | null;
  /** passo das sugestões (30) */ stepMin?: number;
  /** hoje: agora + antecedência; outros dias: null */ notBeforeMin?: number | null;
  /** conflito com outro horário da mesma cliente */ clientId?: string | null;
  /** devolve também os horários que só cabem como encaixe */ allowFitIn?: boolean;
  /** devolve também os horários fora do horário de trabalho */ allowOutsideHours?: boolean;
  /** o serviço "pode ser feito junto com outro" (0084): com `true` dos dois lados, a mesma cliente com outra profissional não conflita */ parallelOk?: boolean | null;
};

export type SlotKind = "livre" | "encaixe" | "fora_do_horario";
export type Conflict = { id: string; label: string };
export type Slot = { start: number; end: number; kind: SlotKind; conflicts: Conflict[]; warnings: string[] };
export type CheckResult =
  | { ok: true; kind: SlotKind; conflicts: Conflict[]; warnings: string[] }
  | { ok: false; reason: "sem_duracao" | "duracao_invalida" | "passou" | "atravessa_meia_noite" | "bloqueado" | "conflito" | "fora_do_horario";
      conflicts: Conflict[]; blockedBy?: string };

const DAY = 1440;
const DEFAULT_STEP = 30;
/** Ocupado sem duração: avisa quem começa até 3 h depois dele. */
const UNKNOWN_WARN_MIN = 180;

const pad = (n: number) => String(n).padStart(2, "0");
/** 600 → "10:00". */
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const overlaps = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && b0 < a1;

function durationError(q: SlotQuery): "sem_duracao" | "duracao_invalida" | null {
  if (q.durationMin == null) return "sem_duracao";
  if (!Number.isInteger(q.durationMin) || q.durationMin <= 0 || q.durationMin > DAY) return "duracao_invalida";
  return null;
}
const bufferOf = (q: SlotQuery) => (Number.isFinite(q.bufferMin) ? Math.max(0, Math.trunc(q.bufferMin!)) : 0);
const stepOf = (q: SlotQuery) => (Number.isInteger(q.stepMin) && q.stepMin! > 0 ? q.stepMin! : DEFAULT_STEP);

/** Tudo o que pesa num início (duração já válida); quem chama decide o que recusa. */
function evaluate(day: DayRules, start: number, dur: number, buf: number, q: SlotQuery) {
  const end = start + dur + buf; // ocupação da profissional
  const clientEnd = start + dur; // a cliente está livre no fim da duração
  const who = day.name?.trim() || "A profissional";
  const blocked = day.blocks.find((b) => !b.pending && overlaps(start, end, b.start, b.end)) ?? null;
  const warnings: string[] = [];
  if (day.blocks.some((b) => b.pending && overlaps(start, end, b.start, b.end))) warnings.push(`${who} pediu folga nesse horário`);
  const conflicts: Conflict[] = [];
  for (const b of day.busy) {
    const hit = b.otherPro
      ? !!q.clientId && b.clientId === q.clientId && !(q.parallelOk === true && b.parallelOk === true) && overlaps(start, clientEnd, b.start, b.clientEnd ?? b.end)
      : overlaps(start, end, b.start, b.end);
    if (hit) conflicts.push({ id: b.id, label: b.label });
  }
  for (const b of day.busy) {
    if (!b.unknownDuration || b.otherPro || conflicts.some((c) => c.id === b.id)) continue;
    if (start > b.start && start <= b.start + UNKNOWN_WARN_MIN) warnings.push(`${who} tem ${b.label} às ${hhmm(b.start)} sem duração informada: confira antes`);
  }
  const inside = day.ranges.some(([a, b]) => start >= a && end <= b);
  return { blocked, conflicts, warnings, inside };
}

const kindOf = (inside: boolean, conflicts: Conflict[]): SlotKind => (!inside ? "fora_do_horario" : conflicts.length ? "encaixe" : "livre");

/** Inícios candidatos: múltiplos do passo contados da meia-noite, dentro das faixas (ou o dia todo, com `allowOutsideHours`). */
function candidates(ranges: [number, number][], step: number, wholeDay: boolean): number[] {
  if (wholeDay) return Array.from({ length: Math.ceil(DAY / step) }, (_, i) => i * step);
  const set = new Set<number>();
  for (const [a, b] of ranges) for (let s = Math.ceil(a / step) * step; s < b; s += step) set.add(s);
  return [...set].sort((x, y) => x - y);
}

/** Os horários livres do dia, em ordem (e, com as flags, os de encaixe e os fora do horário). */
export function freeSlots(day: DayRules, q: SlotQuery): { ok: true; slots: Slot[] } | { ok: false; reason: "sem_duracao" | "duracao_invalida" | "nao_trabalha" } {
  const err = durationError(q);
  if (err) return { ok: false, reason: err };
  if (!day.ranges.length && !q.allowOutsideHours) return { ok: false, reason: "nao_trabalha" };
  const dur = q.durationMin!, buf = bufferOf(q);
  const slots: Slot[] = [];
  for (const s of candidates(day.ranges, stepOf(q), !!q.allowOutsideHours)) {
    if (q.notBeforeMin != null && s < q.notBeforeMin) continue;
    if (s + dur + buf > DAY) continue;
    const ev = evaluate(day, s, dur, buf, q);
    if (ev.blocked) continue;
    if (ev.conflicts.length && !q.allowFitIn) continue;
    if (!ev.inside && !q.allowOutsideHours) continue;
    slots.push({ start: s, end: s + dur, kind: kindOf(ev.inside, ev.conflicts), conflicts: ev.conflicts, warnings: ev.warnings });
  }
  return { ok: true, slots };
}

/** Confere um início escolhido (ex.: tocar na grade, "Marcar"). Recusa na ordem: duração, passou, meia-noite, bloqueio, conflito, fora do horário. */
export function checkStart(day: DayRules, start: number, q: SlotQuery): CheckResult {
  const err = durationError(q);
  if (err) return { ok: false, reason: err, conflicts: [] };
  if (q.notBeforeMin != null && start < q.notBeforeMin) return { ok: false, reason: "passou", conflicts: [] };
  const dur = q.durationMin!, buf = bufferOf(q);
  if (start < 0 || start + dur + buf > DAY) return { ok: false, reason: "atravessa_meia_noite", conflicts: [] };
  const ev = evaluate(day, start, dur, buf, q);
  if (ev.blocked) return { ok: false, reason: "bloqueado", conflicts: [], blockedBy: ev.blocked.title };
  if (ev.conflicts.length && !q.allowFitIn) return { ok: false, reason: "conflito", conflicts: ev.conflicts };
  if (!ev.inside && !q.allowOutsideHours) return { ok: false, reason: "fora_do_horario", conflicts: ev.conflicts };
  return { ok: true, kind: kindOf(ev.inside, ev.conflicts), conflicts: ev.conflicts, warnings: ev.warnings };
}

/**
 * Uma visita com vários serviços: "depois" começa no fim da DURAÇÃO do anterior (a folga não segura a cliente); "junto" começa junto
 * (as profissionais precisam ser diferentes: quem marca confere). Cada item volta com o próprio `checkStart`.
 */
export function planVisit(
  items: { day: DayRules; durationMin: number | null; bufferMin?: number | null; mode: "depois" | "junto" }[],
  start: number, q: Omit<SlotQuery, "durationMin" | "bufferMin">,
): { start: number; end: number; check: CheckResult }[] {
  const out: { start: number; end: number; check: CheckResult }[] = [];
  let prevStart = start, prevEnd = start;
  items.forEach((it, i) => {
    const s = i === 0 ? start : it.mode === "junto" ? prevStart : prevEnd;
    const end = s + (it.durationMin ?? 0);
    out.push({ start: s, end, check: checkStart(it.day, s, { ...q, durationMin: it.durationMin, bufferMin: it.bufferMin }) });
    prevStart = s; prevEnd = end;
  });
  return out;
}

/**
 * "Qualquer uma": entre as que têm o horário LIVRE, a que tem menos horários naquele dia; no empate, a de menor ordem na agenda (vazia
 * por último) e depois a do nome. Ninguém livre → null.
 */
export function pickAny(cands: { id: string; name: string; position: number | null; dayCount: number; kind: SlotKind | null }[]): string | null {
  const pos = (p: number | null) => (p == null ? Number.MAX_SAFE_INTEGER : p);
  const free = cands.filter((c) => c.kind === "livre")
    .sort((a, b) => a.dayCount - b.dayCount || pos(a.position) - pos(b.position) || a.name.localeCompare(b.name, "pt-BR"));
  return free[0]?.id ?? null;
}
