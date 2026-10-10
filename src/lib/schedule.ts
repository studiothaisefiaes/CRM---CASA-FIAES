import { businessDayLabel, isOpen, type BusinessHours } from "./business-hours";

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** Data ("AAAA-MM-DD") e hora ("HH:MM") de Salvador para um instante. */
export function bahiaParts(ms: number): { date: string; time: string } {
  const d = new Date(ms - OFFSET_MS);
  return { date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` };
}

/** O instante de uma data e hora digitadas, lidas no relógio de Salvador (a Casa agenda no horário dela, seja qual for o fuso do aparelho). NaN se incompleto. */
export function slotMs(date: string, time: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return NaN;
  return Date.parse(`${date}T${time}:00-03:00`);
}

export type SlotCheck = { ok: false; error: string } | { ok: true; /** Texto do aviso quando está fora do expediente; null = dentro. */ outsideHours: string | null };

/** Agendar: tem de ser futuro (erro). Fora do expediente só avisa: quem decide é a Casa. */
export function checkSlot(ms: number, now: number, hours: BusinessHours): SlotCheck {
  if (!Number.isFinite(ms)) return { ok: false, error: "Escolha a data e o horário." };
  if (ms <= now) return { ok: false, error: "Esse horário já passou. Escolha um horário futuro." };
  return { ok: true, outsideHours: isOpen(ms, hours) ? null : `Fora do horário de atendimento (${businessDayLabel(ms, hours)}). Dá para agendar mesmo assim.` };
}

/** Sugestão inicial: o horário já marcado (se ainda é futuro) ou 10:00 do próximo dia em que a Casa abre. */
export function defaultSlot(now: number, hours: BusinessHours, existing?: number | null): { date: string; time: string } {
  if (existing && existing > now) return bahiaParts(existing);
  for (let i = 1; i <= 8; i++) {
    const day = now + i * DAY_MS;
    const win = hours[String(new Date(day - OFFSET_MS).getUTCDay()) as keyof BusinessHours];
    if (!win) continue;
    const { date } = bahiaParts(day);
    return { date, time: isOpen(slotMs(date, "10:00"), hours) ? "10:00" : win[0] };
  }
  return { date: bahiaParts(now + DAY_MS).date, time: "10:00" };
}
