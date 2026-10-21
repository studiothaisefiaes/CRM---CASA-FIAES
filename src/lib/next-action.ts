/** Próxima ação: atalhos de data e o texto de "quando". Puro (servidor e navegador), sempre no relógio de Salvador. */
import { windowOfInstant, type BusinessHours } from "./business-hours";
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** O instante em que o relógio de Salvador marca `hour`:`minute`, `dayOffset` dias depois do dia de `ms`. */
export function bahiaAt(ms: number, dayOffset: number, hour: number, minute = 0): Date {
  const local = new Date(ms - OFFSET_MS);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(dayStart + dayOffset * DAY_MS + (hour * 60 + minute) * 60_000 + OFFSET_MS);
}

/** Como `bahiaAt`, mas pula para o próximo dia em que a Casa abre (sem `hours`, não pula). */
function openDayAt(ms: number, dayOffset: number, hour: number, hours?: BusinessHours): Date {
  let off = dayOffset;
  for (let i = 0; hours && i < 7; i++, off++) {
    if (windowOfInstant(bahiaAt(ms, off, 12).getTime(), hours)) break;
  }
  return bahiaAt(ms, off, hour);
}

export type DatePreset = { key: "hoje" | "amanha" | "3dias"; label: string; at: Date };

/** Hoje 18h, Amanhã 10h, Em 3 dias (10h). "Hoje 18h" some depois das 18h: não oferece um horário que já passou. */
export function nextActionPresets(now: number, hours?: BusinessHours): DatePreset[] {
  const hoje = bahiaAt(now, 0, 18);
  return [
    ...(hoje.getTime() > now ? [{ key: "hoje" as const, label: "Hoje 18h", at: hoje }] : []),
    { key: "amanha", label: "Amanhã 10h", at: openDayAt(now, 1, 10, hours) },
    { key: "3dias", label: "Em 3 dias", at: openDayAt(now, 3, 10, hours) },
  ];
}

const wall = (ms: number) => { const d = new Date(ms - OFFSET_MS); return { day: Math.floor((ms - OFFSET_MS) / DAY_MS), wd: d.getUTCDay(), dd: d.getUTCDate(), mm: d.getUTCMonth() + 1, hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` }; };

/** "hoje 18:00", "amanhã 10:00", "ontem 09:00", "ter 14/10 10:00". Passou de hoje: o chamador coloca "atrasada" na frente. */
export function dueLabel(dueMs: number, nowMs: number): string {
  const d = wall(dueMs), n = wall(nowMs);
  const diff = d.day - n.day;
  if (diff === 0) return `hoje ${d.hm}`;
  if (diff === 1) return `amanhã ${d.hm}`;
  if (diff === -1) return `ontem ${d.hm}`;
  return `${WEEKDAY_SHORT[d.wd]} ${pad(d.dd)}/${pad(d.mm)} ${d.hm}`;
}

/** O dia em uma palavra: "hoje", "amanhã", "sex" (até 6 dias) ou "21/10". */
export function dayWord(dueMs: number, nowMs: number): string {
  const d = wall(dueMs), n = wall(nowMs);
  const diff = d.day - n.day;
  if (diff === 0) return "hoje";
  if (diff === 1) return "amanhã";
  if (diff > 1 && diff < 7) return WEEKDAY_SHORT[d.wd];
  return `${pad(d.dd)}/${pad(d.mm)}`;
}

export type RetomarPreset = { key: "hoje" | "amanha" | "sabado" | "3dias"; label: string; at: Date };

/**
 * Atalhos do Retomar (desenho aprovado): "Hoje 15:00" (só se ainda dá e a Casa abre hoje), "Amanhã 10:00" e "Sáb 09:00".
 * Todos pulam dia com a Casa fechada; sem sábado aberto (ou se o sábado já é o "amanhã"), o 3º vira "Em 3 dias".
 */
export function retomarPresets(now: number, hours?: BusinessHours): RetomarPreset[] {
  const openOn = (off: number) => !hours || !!windowOfInstant(bahiaAt(now, off, 12).getTime(), hours);
  const out: RetomarPreset[] = [];
  const hoje = bahiaAt(now, 0, 15);
  if (hoje.getTime() > now + 5 * 60_000 && openOn(0)) out.push({ key: "hoje", label: "Hoje 15:00", at: hoje });
  const amanha = openDayAt(now, 1, 10, hours);
  out.push({ key: "amanha", label: wall(amanha.getTime()).day - wall(now).day === 1 ? "Amanhã 10:00" : `${cap(WEEKDAY_SHORT[wall(amanha.getTime()).wd])} 10:00`, at: amanha });
  const wdNow = wall(now).wd;
  const toSat = ((6 - wdNow + 7) % 7) || 7;
  const sab = bahiaAt(now, toSat, 9);
  if (openOn(toSat) && wall(sab.getTime()).day !== wall(amanha.getTime()).day) out.push({ key: "sabado", label: "Sáb 09:00", at: sab });
  else out.push({ key: "3dias", label: "Em 3 dias", at: openDayAt(now, 3, 10, hours) });
  return out;
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type ResumePreset = { key: "amanha" | "3dias" | "semana" | "mes"; label: string; at: Date };

/** "Retomar depois": quando voltar a falar com a cliente (sempre 10h de Salvador; "Em 1 mês" = 30 dias). Com `hours`, dia fechado vira o próximo aberto. */
export function resumePresets(now: number, hours?: BusinessHours): ResumePreset[] {
  return [
    { key: "amanha", label: "Amanhã", at: openDayAt(now, 1, 10, hours) },
    { key: "3dias", label: "Em 3 dias", at: openDayAt(now, 3, 10, hours) },
    { key: "semana", label: "Em 1 semana", at: openDayAt(now, 7, 10, hours) },
    { key: "mes", label: "Em 1 mês", at: openDayAt(now, 30, 10, hours) },
  ];
}

/** Combinado vencido em que a Casa já escreveu depois do vencimento: provavelmente já foi feito; a tela sugere "Marcar como feito" com um toque. */
export const answeredAfterDue = (dueMs: number, lastOutboundMs: number | null | undefined, nowMs: number): boolean =>
  dueMs < nowMs && lastOutboundMs != null && lastOutboundMs > dueMs;
