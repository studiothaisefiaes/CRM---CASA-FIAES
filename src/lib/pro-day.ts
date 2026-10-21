/**
 * App da profissional: textos e contas do dia, sempre no relógio de Salvador. Puro (servidor e navegador).
 * Trabalha em minutos do dia (0 a 1440), como o motor de horários (`src/lib/free-slots.ts`).
 */
import { bahiaParts, slotMs } from "./schedule";
import { shiftDay } from "./agenda";

const TZ = "America/Bahia";
const DAY_TITLE = new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "long", day: "numeric", month: "short" });

/** Status do horário na tela da profissional. "Finalizado" é `compareceu` no banco (o 1C lê esse nome). */
export const PRO_STATUS_LABEL: Record<string, string> = {
  agendado: "Agendado", confirmado: "Confirmado", chegou: "Chegou", em_atendimento: "Em atendimento",
  compareceu: "Finalizado", faltou: "Faltou", cancelado: "Cancelado", solicitado: "Pedido pelo site",
};
/** O que aparece na agenda dela. Cancelado, lista de espera e gêmeo do Avec ficam de fora. */
export const PRO_VISIBLE_STATUSES = ["agendado", "confirmado", "chegou", "em_atendimento", "compareceu", "faltou", "solicitado", "conferir"] as const;

/** "MAIARA" → "Maiara"; "ANA PAULA" → "Ana Paula". */
export const titleCase = (s: string) => s.trim().toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** "Bom dia" até 11:59, "Boa tarde" até 17:59 e "Boa noite" depois (Salvador). */
export function greeting(nowMs: number): string {
  const h = Number(bahiaParts(nowMs).time.slice(0, 2));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

/** "AAAA-MM-DD" → "sexta, 16 de out". */
export const dayTitle = (day: string) => DAY_TITLE.format(new Date(slotMs(day, "12:00"))).replace("-feira", "").replace(".", "");

/** 540 → "9h"; 810 → "13h30". */
export const hourLabel = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
};
/** As faixas do dia: "9h–18h" ou "9h–12h e 13h–18h". Sem faixa: "Folga". */
export const rangesLabel = (ranges: [number, number][]) => (ranges.length ? ranges.map(([a, b]) => `${hourLabel(a)}–${hourLabel(b)}`).join(" e ") : "Folga");

/** "Bom dia, Maiara" e "sexta, 16 de out · 6 clientes · 9h–18h". */
export function todayHeader(i: { name: string; nowMs: number; day: string; clients: number; ranges: [number, number][] }) {
  const n = i.clients === 1 ? "1 cliente" : `${i.clients} clientes`;
  return { greeting: `${greeting(i.nowMs)}, ${titleCase(i.name)}`, line: [dayTitle(i.day), n, rangesLabel(i.ranges)].join(" · ") };
}

/** "10:00" (Salvador). */
export const timeOf = (ms: number) => bahiaParts(ms).time;
/** O minuto do dia (Salvador) de um instante. */
export const minuteIn = (ms: number) => { const t = bahiaParts(ms).time; return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); };
/** O instante de um minuto do dia em Salvador. */
export const atMinute = (day: string, min: number) => new Date(slotMs(day, "00:00") + min * 60_000);
/** 620 → "10:20". */
export const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

const span = (min: number) => { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`; };
/** Quanto falta para começar: "agora", "em 25 min", "em 1h10"; já começou: "há 5 min". */
export function untilLabel(startMs: number, nowMs: number): string {
  const d = Math.round((startMs - nowMs) / 60_000);
  if (d === 0) return "agora";
  return d > 0 ? `em ${span(d)}` : `há ${span(-d)}`;
}

export type TimelineAppt = { id: string; start: number; durationMin: number | null; status: string };
export type TimelineBlock = { id: string; title: string; start: number; end: number; pending: boolean };
export type TimelineRow =
  | { kind: "horario"; id: string; start: number }
  | { kind: "livre"; start: number; end: number }
  | { kind: "bloqueio"; id: string; title: string; start: number; end: number; pending: boolean };

/**
 * A linha do dia: horários, bloqueios e os buracos livres dentro do horário de trabalho ("Livre 11:20–13:00").
 * - horário sem duração ocupa um passo da grade (como no motor: a duração nunca é inventada);
 * - faltou não ocupa;
 * - pedido de folga ainda não aprovado aparece, mas não ocupa;
 * - livre com menos de 15 min não aparece.
 */
export function dayTimeline(i: { ranges: [number, number][]; appts: TimelineAppt[]; blocks: TimelineBlock[]; stepMin?: number }): TimelineRow[] {
  const step = i.stepMin ?? 30;
  const busy: [number, number][] = [
    ...i.appts.filter((a) => a.status !== "faltou").map((a): [number, number] => [a.start, a.start + (a.durationMin && a.durationMin > 0 ? a.durationMin : step)]),
    ...i.blocks.filter((b) => !b.pending).map((b): [number, number] => [b.start, b.end]),
  ].sort((a, b) => a[0] - b[0]);
  const free: { start: number; end: number }[] = [];
  for (const [rs, re] of [...i.ranges].sort((a, b) => a[0] - b[0])) {
    let cur = rs;
    for (const [bs, be] of busy) {
      if (be <= cur || bs >= re) continue;
      if (bs > cur) free.push({ start: cur, end: Math.min(bs, re) });
      cur = Math.max(cur, be);
      if (cur >= re) break;
    }
    if (cur < re) free.push({ start: cur, end: re });
  }
  const order = { bloqueio: 0, horario: 1, livre: 2 } as const;
  const rows: TimelineRow[] = [
    ...i.blocks.map((b) => ({ kind: "bloqueio" as const, ...b })),
    ...i.appts.map((a) => ({ kind: "horario" as const, id: a.id, start: a.start })),
    ...free.filter((f) => f.end - f.start >= 15).map((f) => ({ kind: "livre" as const, ...f })),
  ];
  return rows.sort((a, b) => a.start - b.start || order[a.kind] - order[b.kind]);
}

export type ProAction = "chegou" | "iniciar" | "finalizar" | "faltou";
export const PRO_ACTION_LABEL: Record<ProAction, string> = { chegou: "Chegou", iniciar: "Iniciar", finalizar: "Finalizar", faltou: "Faltou" };
/** O status que cada botão grava (pela porta única do 6B). */
export const PRO_ACTION_STATUS: Record<ProAction, "chegou" | "em_atendimento" | "compareceu" | "faltou"> = {
  chegou: "chegou", iniciar: "em_atendimento", finalizar: "compareceu", faltou: "faltou",
};
/** A profissional só marca falta 15 min depois do início (seção 4.3). */
export const NO_SHOW_AFTER_MIN = 15;

/** Os botões de um horário, o próximo passo primeiro (a mesma tabela de transições da seção 4.3; quem decide é a porta do 6B). */
export function proActionsFor(status: string, startMs: number, nowMs: number): ProAction[] {
  const sameDay = bahiaParts(startMs).date === bahiaParts(nowMs).date;
  const waiting = status === "agendado" || status === "confirmado";
  const out: ProAction[] = [];
  if (waiting && sameDay) out.push("chegou", "iniciar");
  if (status === "chegou") out.push("iniciar", "finalizar");
  if (status === "em_atendimento") out.push("finalizar");
  if (waiting && nowMs >= startMs) out.push("finalizar");
  if (waiting && nowMs >= startMs + NO_SHOW_AFTER_MIN * 60_000) out.push("faltou");
  return out;
}

/** A próxima cliente: a que está na cadeira (chegou ou em atendimento); senão a próxima agendada ou confirmada, até 15 min depois do início. */
export function pickNext<T extends { status: string; start: number }>(items: T[], nowMin: number): T | null {
  return items.find((i) => i.status === "chegou" || i.status === "em_atendimento")
    ?? items.find((i) => (i.status === "agendado" || i.status === "confirmado") && i.start + NO_SHOW_AFTER_MIN >= nowMin) ?? null;
}

/** Aniversário nos próximos 7 dias, hoje incluído. 29/02 conta como 28/02 em ano que não é bissexto. */
export function birthdayWithin(day: number | null, month: number | null, today: string, days = 7): boolean {
  if (!day || !month) return false;
  for (let k = 0; k < days; k++) {
    const d = shiftDay(today, k);
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)), dd = Number(d.slice(8, 10));
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (m === month && dd === (month === 2 && day === 29 && !leap ? 28 : day)) return true;
  }
  return false;
}

/** "12/08 · Luzes com a Bia" (nunca o valor). */
export function lastVisitLabel(v: { startsAt: Date; service: string; professional: string | null }): string {
  const d = bahiaParts(v.startsAt.getTime()).date;
  return `${d.slice(8, 10)}/${d.slice(5, 7)} · ${v.service}${v.professional ? ` com a ${titleCase(v.professional)}` : ""}`;
}
