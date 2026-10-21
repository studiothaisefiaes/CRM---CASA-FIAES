/**
 * Ritmo de volta, retorno sugerido e aniversário da cliente (Lote 2). Puro: servidor e navegador.
 * As MESMAS constantes entram na SQL da lista de Contatos (src/server/queries/contacts.ts): ficha e filtro nunca discordam.
 */
export const MIN_VISITS_FOR_RHYTHM = 3;
/** A partir de 0,8× o ritmo sem vir (e sem horário): "na hora de voltar". */
export const RETURN_SOON = 0.8;
/** Passou de 1,5× o ritmo: "sumida" (até 1 ano; depois disso é "antiga", outra conversa). */
export const RETURN_GONE = 1.5;
export const GONE_MAX_DAYS = 365;
/** Horário futuro só conta até 180 dias: o mesmo FUTURE_MAX_DAYS do Lote 1C (src/server/domain/avec/funnel-sync.ts). */
export const FUTURE_HORIZON_DAYS = 180;
/** Profissional preferida calculada: 3 ou mais serviços e 60% ou mais com a mesma. */
export const PREFERRED_MIN_SERVICES = 3;
export const PREFERRED_MIN_SHARE = 0.6;
/** VIP: 12+ visitas ou entre as 10% que mais gastaram (a tela para configurar é do Lote 4). */
export const VIP_MIN_VISITS = 12;
export const VIP_TOP_SHARE = 0.1;
/** Faltosa: 2 ou mais faltas. */
export const FALTOSA_MIN = 2;
/** "Aniversário nesta semana": hoje e os próximos 7 dias, a mesma janela do Hoje (src/server/queries/today.ts). */
export const BIRTHDAY_WEEK_DAYS = 7;

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** "aaaa-mm-dd" do instante, no relógio de Salvador. */
export const bahiaDay = (ms: number): string => new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
/** Dias de `from` até `to` (negativo se `to` vem antes). */
export const daysBetween = (from: string, to: string): number => Math.round((dayMs(to) - dayMs(from)) / DAY_MS);
export const addDaysTo = (day: string, n: number): string => new Date(dayMs(day) + n * DAY_MS).toISOString().slice(0, 10);
/** "02/11" no ano de hoje; "02/11/2027" em outro ano. */
export const shortDay = (day: string, today: string): string =>
  `${day.slice(8, 10)}/${day.slice(5, 7)}${day.slice(0, 4) === today.slice(0, 4) ? "" : `/${day.slice(0, 4)}`}`;

export type ReturnStatus = "agendada" | "em_dia" | "na_hora" | "sumida" | "antiga";
export type ReturnInfo = { basis: "ritmo" | "ciclo"; everyDays: number; dueOn: string; daysSince: number; lateDays: number; status: ReturnStatus };
/** `rhythmDays` só vem preenchido com 3+ visitas (a visão por contato garante); sem ele, vale o ciclo do serviço. */
export type RhythmInput = { lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null; hasFuture: boolean };

/** Quando a cliente deve voltar e como ela está em relação a isso. null = sem visita ou sem ritmo nem ciclo. */
export function returnInfo(s: RhythmInput, today: string): ReturnInfo | null {
  if (!s.lastVisitOn) return null;
  const basis = s.rhythmDays ? "ritmo" : s.cycleDays ? "ciclo" : null;
  if (!basis) return null;
  const everyDays = basis === "ritmo" ? s.rhythmDays! : s.cycleDays!;
  const daysSince = Math.max(0, daysBetween(s.lastVisitOn, today));
  const dueOn = addDaysTo(s.lastVisitOn, everyDays);
  // A SQL da lista usa exatamente estas comparações (>= 0,8×; <= 1,5×; < 365).
  const status: ReturnStatus = s.hasFuture ? "agendada"
    : daysSince < RETURN_SOON * everyDays ? "em_dia"
    : daysSince <= RETURN_GONE * everyDays ? "na_hora"
    : daysSince < GONE_MAX_DAYS ? "sumida" : "antiga";
  return { basis, everyDays, dueOn, daysSince, lateDays: Math.max(0, daysBetween(dueOn, today)), status };
}

/** "Volta a cada ~45 dias · prevista 02/11 · atrasada 12 dias" (sem ritmo: "Pelo ciclo do serviço, a cada 30 dias · …"). */
export function returnLine(r: ReturnInfo, today: string): string {
  const head = r.basis === "ritmo" ? `Volta a cada ~${r.everyDays} dias` : `Pelo ciclo do serviço, a cada ${r.everyDays} dias`;
  const left = daysBetween(today, r.dueOn);
  const tail = r.status === "agendada" ? "já tem horário marcado"
    : r.lateDays > 0 ? `atrasada ${r.lateDays} ${r.lateDays === 1 ? "dia" : "dias"}`
    : left === 0 ? "é hoje" : left === 1 ? "falta 1 dia" : `faltam ${left} dias`;
  return `${head} · prevista ${shortDay(r.dueOn, today)} · ${tail}`;
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Dias até o próximo aniversário (0 = hoje). 29/02 em ano não bissexto cai em 28/02, como no Hoje. */
export function daysUntilBirthday(day: number, month: number, today: string): number {
  const y = Number(today.slice(0, 4));
  for (const year of [y, y + 1]) {
    const d = month === 2 && day === 29 && !isLeap(year) ? 28 : day;
    const diff = daysBetween(today, `${year}-${pad(month)}-${pad(d)}`);
    if (diff >= 0) return diff;
  }
  return 365;
}

/** Nome do Avec em maiúsculas ("MAIARA") vira "Maiara"; nome já escrito com minúsculas fica como está. */
export function displayName(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\S)/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** "Lembrar": no dia previsto às 10h de Salvador; se já passou (ou não há previsão), amanhã às 10h. */
export function reminderDueAt(dueOn: string | null, nowMs: number): Date {
  const at10 = (day: string) => new Date(dayMs(day) + 10 * 3_600_000 + OFFSET_MS);
  if (dueOn) {
    const d = at10(dueOn);
    if (d.getTime() > nowMs) return d;
  }
  return at10(addDaysTo(bahiaDay(nowMs), 1));
}
