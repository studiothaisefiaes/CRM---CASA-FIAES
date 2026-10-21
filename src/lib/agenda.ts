/**
 * Agenda: o período que a tela mostra (um dia ou uma semana de segunda a domingo, sempre no fuso de Salvador) e a situação de cada horário.
 * Funções puras: servem à consulta no servidor e à tela.
 */
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, sem horário de verão
const DAY_MS = 86_400_000;

/** Dia (grade com a lista de profissionais ao lado, modelo B), Semana (sete colunas) e Lista (o dia por horário). */
export type AgendaView = "dia" | "semana" | "lista";
export type AgendaRange = { day: string; view: AgendaView; from: Date; days: number };

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** Meia-noite de Salvador do dia "AAAA-MM-DD", em ms UTC. */
const midnight = (day: string) => Date.parse(`${day}T00:00:00Z`) + OFFSET_MS;
const validDay = (d: unknown): d is string =>
  typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && iso(Date.parse(`${d}T00:00:00Z`)) === d;

/** Hoje em Salvador, "AAAA-MM-DD". */
export const todayBahia = (now: Date) => iso(now.getTime() - OFFSET_MS);
export const shiftDay = (day: string, n: number) => iso(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);

/** Lê `?d=AAAA-MM-DD&v=dia|semana|lista`. Qualquer coisa inválida cai em hoje / Dia. */
export function agendaRange(params: { d?: string | string[]; v?: string | string[] }, now: Date): AgendaRange {
  const day = validDay(params.d) ? params.d : todayBahia(now);
  const view: AgendaView = params.v === "semana" ? "semana" : params.v === "lista" ? "lista" : "dia"; // "profissionais" (6A) cai em "dia"
  if (view !== "semana") return { day, view, from: new Date(midnight(day)), days: 1 };
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // segunda = 0
  return { day, view, from: new Date(midnight(shiftDay(day, -weekday))), days: 7 };
}

/** Os dias do período, "AAAA-MM-DD". */
export const weekDays = (r: AgendaRange) => Array.from({ length: r.days }, (_, i) => iso(r.from.getTime() - OFFSET_MS + i * DAY_MS));

/** O dia (Salvador) de um horário. */
export const dayOf = (at: string | Date) => iso(new Date(at).getTime() - OFFSET_MS);

export type AgendaStatus = "solicitado" | "agendado" | "confirmado" | "chegou" | "em_atendimento" | "conferir" | "compareceu" | "faltou" | "remarcou" | "perdido" | "cancelado";

/** Já marcado vale como está; sem marcação, antes da hora é Agendado (ou Confirmado) e depois da hora pede conferência. */
export function agendaStatus(i: { scheduledAt: string; attendance: string | null; stageKind: string }, now: Date): AgendaStatus {
  if (i.attendance === "compareceu" || i.attendance === "faltou" || i.attendance === "remarcou") return i.attendance;
  if (i.stageKind === "perdido") return "perdido";
  const past = new Date(i.scheduledAt).getTime() <= now.getTime();
  if (past) return "conferir";
  return i.attendance === "confirmado" ? "confirmado" : "agendado";
}

export const STATUS_LABEL: Record<AgendaStatus, string> = {
  solicitado: "Pedido pelo site", agendado: "Agendado", confirmado: "Confirmado", chegou: "Chegou", em_atendimento: "Em atendimento",
  conferir: "Conferir", compareceu: "Finalizado", faltou: "Faltou", remarcou: "Remarcou", perdido: "Perdido", cancelado: "Cancelado",
};

const KEEP = new Set(["solicitado", "chegou", "em_atendimento", "compareceu", "faltou", "cancelado", "conferir"]);
/** Agendamento: os status do ciclo de vida valem como estão; só agendado e confirmado que já passaram pedem conferência. */
export function appointmentAgendaStatus(a: { startsAt: string; status: string }, now: Date): AgendaStatus {
  if (KEEP.has(a.status)) return a.status as AgendaStatus;
  if (new Date(a.startsAt).getTime() <= now.getTime()) return "conferir";
  return a.status === "confirmado" ? "confirmado" : "agendado";
}

/** Sem duração no horário nem no serviço: 60 min, mostrado como estimado (nunca gravado). */
export const DEFAULT_DURATION_MIN = 60;
export function entryDuration(own: number | null | undefined, service: number | null | undefined): { minutes: number; estimated: boolean } {
  if (own && own > 0) return { minutes: own, estimated: false };
  if (service && service > 0) return { minutes: service, estimated: false };
  return { minutes: DEFAULT_DURATION_MIN, estimated: true };
}

/* ───────────── Grade do dia ───────────── */

const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
/** O instante de um minuto do dia em Salvador (0 a 1440). */
export const instantOf = (day: string, minute: number) => new Date(Date.parse(`${day}T00:00:00Z`) + OFFSET_MS + minute * 60_000);
/** Minuto do dia em Salvador de um instante. */
export const minuteOfDay = (at: string | Date) => {
  const d = new Date(new Date(at).getTime() - OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
};
/** "HH:MM" → minuto do dia; null se não for hora. */
export function hmToMinutes(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(v?.trim() ?? "");
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
}

/**
 * Horários que se sobrepõem na mesma coluna ficam lado a lado: cada um ganha uma faixa (`lane`) e o grupo que se sobrepõe divide a largura
 * em `lanes`. Quem começa quando outro termina reaproveita a faixa dele.
 */
export function layoutLanes(items: { key: string; start: number; end: number }[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  let group: { key: string; lane: number }[] = [], laneEnds: number[] = [], groupEnd = -Infinity;
  const flush = () => { for (const g of group) out.set(g.key, { lane: g.lane, lanes: laneEnds.length }); group = []; laneEnds = []; };
  for (const it of sorted) {
    if (it.start >= groupEnd) { flush(); groupEnd = -Infinity; }
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(it.end); } else laneEnds[lane] = it.end;
    group.push({ key: it.key, lane });
    groupEnd = Math.max(groupEnd, it.end);
  }
  flush();
  return out;
}

/** 30 → "30 min", 60 → "1h", 90 → "1h30". */
export function durationLabel(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
/** "09:00 – 10:30" (Salvador). */
export function timeRange(startsAt: string, durationMin: number): string {
  const a = minuteOfDay(startsAt), b = (a + durationMin) % (24 * 60);
  return `${hm(a)} – ${hm(b)}`;
}

/** Pacotes: "vence em 12 dias", "vence hoje", "venceu em 03/10/2026", "sem validade" (datas "aaaa-mm-dd"). */
export function validityLabel(validUntil: string | null, today: string): string {
  if (!validUntil) return "sem validade";
  const days = Math.round((Date.parse(`${validUntil}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (days < 0) return `venceu em ${validUntil.slice(8, 10)}/${validUntil.slice(5, 7)}/${validUntil.slice(0, 4)}`;
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}
