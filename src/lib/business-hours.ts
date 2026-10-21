/** Horário de atendimento. Dias: 0 = domingo … 6 = sábado. null = fechado. Horas "HH:MM" no fuso de Salvador (UTC-3). */
export type DayKey = "0" | "1" | "2" | "3" | "4" | "5" | "6";
/** `especiais`: dias avulsos "AAAA-MM-DD" (feriado, horário reduzido) que vencem o dia da semana; `null` = fechado nesse dia. */
export type BusinessHours = Record<DayKey, [string, string] | null> & { especiais?: Record<string, [string, string] | null> };

// Premissa (editável em Configurações): seg–sex 8h–20h, sáb 8h–17h, domingo fechado.
export const DEFAULT_HOURS: BusinessHours = {
  "0": null, "1": ["08:00", "20:00"], "2": ["08:00", "20:00"], "3": ["08:00", "20:00"], "4": ["08:00", "20:00"], "5": ["08:00", "20:00"], "6": ["08:00", "17:00"],
};

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, sem horário de verão
/**
 * O expediente do dia que começa em `dayStartLocalMs` (meia-noite de Salvador escrita como UTC, ou seja, o dia local em ms):
 * o dia especial vence o dia da semana (`null` = fechado, mesmo num dia que a semana abre).
 */
export function windowOf(dayStartLocalMs: number, hours: BusinessHours): [string, string] | null {
  const d = new Date(dayStartLocalMs);
  const esp = hours.especiais;
  if (esp) {
    const day = d.toISOString().slice(0, 10);
    if (Object.hasOwn(esp, day)) return esp[day];
  }
  return hours[String(d.getUTCDay()) as DayKey];
}
/** O expediente do dia de Salvador em que cai o instante `ms` (dia especial vence o dia da semana). */
export function windowOfInstant(ms: number, hours: BusinessHours): [string, string] | null {
  const d = new Date(ms - OFFSET_MS);
  return windowOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), hours);
}
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };

/** Minutos de expediente entre dois instantes (ex.: quanto tempo útil a cliente está esperando). */
export function businessMinutesBetween(fromMs: number, toMs: number, hours: BusinessHours = DEFAULT_HOURS): number {
  return Math.floor(businessSecondsBetween(fromMs, toMs, hours) / 60);
}

/** Segundos de expediente entre dois instantes: o cronômetro da tela pausa com a Casa fechada. */
export function businessSecondsBetween(fromMs: number, toMs: number, hours: BusinessHours = DEFAULT_HOURS): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  // percorre dia a dia no horário local
  let cursor = fromMs - OFFSET_MS;
  const end = toMs - OFFSET_MS;
  for (let guard = 0; cursor < end && guard < 400; guard++) {
    const d = new Date(cursor);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const win = windowOf(dayStart, hours);
    if (win) {
      const open = dayStart + toMin(win[0]) * 60_000, close = dayStart + toMin(win[1]) * 60_000;
      const a = Math.max(cursor, open), b = Math.min(end, close);
      if (b > a) total += (b - a) / 1000;
    }
    cursor = dayStart + 86_400_000;
  }
  return Math.floor(total);
}

/**
 * O instante em que, contando só o expediente, faltam `seconds` segundos para chegar em `toMs` (o inverso de `businessSecondsBetween`).
 * Com a Casa fechada, volta para dentro do último expediente. A demonstração usa para pôr as esperas da Fila "há X min" em relação ao agora.
 */
export function businessInstantBefore(toMs: number, seconds: number, hours: BusinessHours = DEFAULT_HOURS): number {
  let remaining = seconds * 1000;
  let cursor = toMs - OFFSET_MS; // horário local de Salvador
  for (let guard = 0; guard < 400; guard++) {
    const d = new Date(cursor - 1);
    const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const win = windowOf(dayStart, hours);
    if (win) {
      const open = dayStart + toMin(win[0]) * 60_000, close = dayStart + toMin(win[1]) * 60_000;
      const end = Math.min(cursor, close);
      if (end > open) {
        if (end - open >= remaining) return end - remaining + OFFSET_MS;
        remaining -= end - open;
      }
    }
    cursor = dayStart;
  }
  throw new Error("Sem expediente configurado para voltar no tempo");
}

export function isOpen(atMs: number, hours: BusinessHours = DEFAULT_HOURS) {
  const d = new Date(atMs - OFFSET_MS);
  const win = windowOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), hours);
  if (!win) return false;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= toMin(win[0]) && m < toMin(win[1]);
}

/** Quando a Casa abre de novo depois de `atMs` (o início do próximo expediente; dia especial vale). null sem expediente nos próximos 8 dias. */
export function nextOpeningAfter(atMs: number, hours: BusinessHours = DEFAULT_HOURS): number | null {
  const local = atMs - OFFSET_MS;
  const d = new Date(local);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (let i = 0; i <= 8; i++) {
    const dayStart = today + i * 86_400_000;
    const win = windowOf(dayStart, hours);
    if (!win) continue;
    const open = dayStart + toMin(win[0]) * 60_000;
    if (open > local) return open + OFFSET_MS;
  }
  return null;
}

/**
 * Quando a Casa fechou pela última vez até `atMs`: o fim do último expediente que já terminou (null sem expediente nos 7 dias antes).
 * Os lembretes usam para não perder o que venceu com a Casa fechada (sábado à noite, domingo e segunda): ele avisa quando ela abre.
 */
export function lastClosingBefore(atMs: number, hours: BusinessHours = DEFAULT_HOURS): number | null {
  const local = atMs - OFFSET_MS;
  const d = new Date(local);
  const today = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  for (let i = 0; i <= 7; i++) {
    const dayStart = today - i * 86_400_000;
    const win = windowOf(dayStart, hours);
    if (!win) continue;
    const close = dayStart + toMin(win[1]) * 60_000;
    if (close <= local) return close + OFFSET_MS;
  }
  return null;
}

/**
 * Dias inteiros entre dois instantes sem contar os dias em que a Casa não abre (domingo e segunda no horário da Casa).
 * "Parado há N dias" usa esta conta: a conversa de sábado à tarde não está parada na terça de manhã. A noite dos dias abertos conta.
 */
export function daysCountingOpenDays(fromMs: number, toMs: number, hours: BusinessHours = DEFAULT_HOURS): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  let cursor = fromMs - OFFSET_MS;
  const end = toMs - OFFSET_MS;
  for (let guard = 0; cursor < end && guard < 4000; guard++) {
    const d = new Date(cursor);
    const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) + 86_400_000;
    if (windowOf(next - 86_400_000, hours)) total += Math.min(next, end) - cursor;
    cursor = next;
  }
  return Math.floor(total / 86_400_000);
}

const WEEKDAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const stripZero = (hhmm: string) => hhmm.replace(/^0/, "");

/** O expediente do dia de `atMs` para avisar quem agenda fora dele: "sábado, das 8:00 às 17:00" ou "domingo, a Casa não abre". */
export function businessDayLabel(atMs: number, hours: BusinessHours = DEFAULT_HOURS): string {
  const d = new Date(atMs - OFFSET_MS);
  const dow = d.getUTCDay();
  const win = windowOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), hours);
  return win ? `${WEEKDAY_NAME[dow]}, das ${stripZero(win[0])} às ${stripZero(win[1])}` : `${WEEKDAY_NAME[dow]}, a Casa não abre`;
}
