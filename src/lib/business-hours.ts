/** Horário de atendimento. Dias: 0 = domingo … 6 = sábado. null = fechado. Horas "HH:MM" no fuso de Salvador (UTC-3). */
export type BusinessHours = Record<"0" | "1" | "2" | "3" | "4" | "5" | "6", [string, string] | null>;

// Premissa (editável em Configurações): seg–sex 8h–20h, sáb 8h–17h, domingo fechado.
export const DEFAULT_HOURS: BusinessHours = {
  "0": null, "1": ["08:00", "20:00"], "2": ["08:00", "20:00"], "3": ["08:00", "20:00"], "4": ["08:00", "20:00"], "5": ["08:00", "20:00"], "6": ["08:00", "17:00"],
};

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, sem horário de verão
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
    const win = hours[String(d.getUTCDay()) as keyof BusinessHours];
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
    const win = hours[String(d.getUTCDay()) as keyof BusinessHours];
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
  const win = hours[String(d.getUTCDay()) as keyof BusinessHours];
  if (!win) return false;
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= toMin(win[0]) && m < toMin(win[1]);
}

const WEEKDAY_NAME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const stripZero = (hhmm: string) => hhmm.replace(/^0/, "");

/** O expediente do dia de `atMs` para avisar quem agenda fora dele: "sábado, das 8:00 às 17:00" ou "domingo, a Casa não abre". */
export function businessDayLabel(atMs: number, hours: BusinessHours = DEFAULT_HOURS): string {
  const d = new Date(atMs - OFFSET_MS);
  const dow = d.getUTCDay();
  const win = hours[String(dow) as keyof BusinessHours];
  return win ? `${WEEKDAY_NAME[dow]}, das ${stripZero(win[0])} às ${stripZero(win[1])}` : `${WEEKDAY_NAME[dow]}, a Casa não abre`;
}
