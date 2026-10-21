/** Campos de dia (type="date") e hora (type="time") sempre no relógio de Salvador (UTC-3 fixo, sem horário de verão). */
const OFFSET_MS = 3 * 3_600_000;
export const bahiaDateInput = (ms: number) => new Date(ms - OFFSET_MS).toISOString().slice(0, 10);
export const bahiaTimeInput = (ms: number) => new Date(ms - OFFSET_MS).toISOString().slice(11, 16);
/** "2026-10-21" + "10:00" → o instante em Salvador; inválido → null. */
export function fromBahiaInputs(day: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const d = new Date(`${day}T${time}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}
