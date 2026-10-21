/** Pedido de folga ou bloqueio da profissional (app): validação e texto do período. Puro. Mesmas regras do bloqueio do 6A (seção 5.5). */
export const LEAVE_REASONS = { folga: "Folga", atestado: "Atestado", curso: "Curso", outro: "Outro" } as const;
export type LeaveReason = keyof typeof LEAVE_REASONS;
export type LeaveInput = { startsOn: string; endsOn: string; allDay: boolean; startTime: string; endTime: string; reason: string; note: string };
export type LeaveRow = { startsOn: string; endsOn: string; startTime: string; endTime: string; reason: LeaveReason; title: string; notes: string | null };

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DAY_MS = 86_400_000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export function validateLeave(i: LeaveInput, today: string): { ok: true; row: LeaveRow } | { ok: false; error: string } {
  if (!(i.reason in LEAVE_REASONS)) return { ok: false, error: "Escolha o motivo." };
  const reason = i.reason as LeaveReason;
  if (!DAY_RE.test(i.startsOn) || !DAY_RE.test(i.endsOn) || Number.isNaN(Date.parse(i.startsOn)) || Number.isNaN(Date.parse(i.endsOn))) return { ok: false, error: "Escolha o dia." };
  if (i.startsOn < today) return { ok: false, error: "Escolha um dia de hoje em diante." };
  if (i.endsOn < i.startsOn) return { ok: false, error: "A data final não pode vir antes da inicial." };
  if (daysBetween(i.startsOn, i.endsOn) > 366) return { ok: false, error: "O período passa de 366 dias." };
  const startTime = i.allDay ? "00:00" : i.startTime, endTime = i.allDay ? "24:00" : i.endTime;
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) return { ok: false, error: "Escolha a hora." };
  if (endTime <= startTime) return { ok: false, error: "A hora final precisa ser depois da inicial." };
  const note = i.note.trim().replace(/\s+/g, " ");
  if (note.length > 200) return { ok: false, error: "Use até 200 caracteres na observação." };
  if (reason === "outro" && note.length < 3) return { ok: false, error: "Escreva o motivo." };
  return { ok: true, row: { startsOn: i.startsOn, endsOn: i.endsOn, startTime, endTime, reason, title: reason === "outro" ? note.slice(0, 60) : LEAVE_REASONS[reason], notes: note || null } };
}

const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "20/10 (dia todo)", "20/10 a 22/10 (dia todo)", "20/10, das 14:00 às 18:00". */
export function periodLabel(r: { startsOn: string; endsOn: string; startTime: string; endTime: string }): string {
  const dias = r.startsOn === r.endsOn ? br(r.startsOn) : `${br(r.startsOn)} a ${br(r.endsOn)}`;
  return r.startTime === "00:00" && r.endTime === "24:00" ? `${dias} (dia todo)` : `${dias}, das ${r.startTime} às ${r.endTime}`;
}
