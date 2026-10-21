/**
 * Nova Agenda › Dia (16/10): a cor do status no cartão, o que está "sem baixa", onde dá para soltar um horário arrastado (ou escolhido
 * no "Mover…"), os buracos livres e a ocupação de cada profissional. Funções puras: a tela usa para responder na hora; o servidor
 * (rescheduleAppointment) continua sendo quem decide de verdade.
 */
import { instantOf, minuteOfDay, shiftDay, type AgendaRange } from "./agenda";
import { START_GRACE_MIN } from "./appointment-status";

export const VIEW_STATUSES = ["marcado", "pedido", "confirmado", "chegou", "atendendo", "finalizado", "pago", "faltou", "sembaixa", "encerrado", "cancelado"] as const;
export type ViewStatus = (typeof VIEW_STATUSES)[number];

/**
 * O cartão inteiro pinta com a cor do status, como no Avec (pedido do dono, 16/10: sem a faixa fina).
 * `bg` = fundo do cartão, `fg` = texto (contraste ≥ 4.5:1), `bar` = cor forte (legenda e borda). Vermelho só para atraso real (sem baixa).
 */
export const VIEW_STATUS: Record<ViewStatus, { bar: string; bg: string; fg: string; label: string }> = {
  marcado: { bar: "#948e83", bg: "#ebe8e2", fg: "#2a2a29", label: "Marcado" },
  pedido: { bar: "#948e83", bg: "#efe8da", fg: "#5c4a22", label: "Pedido pelo site" },
  confirmado: { bar: "#2f6b4f", bg: "#d6eadd", fg: "#1d4532", label: "Confirmado" },
  chegou: { bar: "#b8863f", bg: "#f4e1bf", fg: "#5e4116", label: "Chegou, na Casa" },
  atendendo: { bar: "#5b4bb0", bg: "#dcd6f3", fg: "#33276b", label: "Atendendo" },
  finalizado: { bar: "#4f6b8f", bg: "#d9e3f0", fg: "#25374f", label: "Finalizado, falta pagar" },
  pago: { bar: "#a9a49b", bg: "#efeeeb", fg: "#5c5c5c", label: "Finalizado" },
  faltou: { bar: "#c9c4bb", bg: "#f5f4f1", fg: "#6f6a62", label: "Faltou" },
  sembaixa: { bar: "#b3261e", bg: "#f8d9d5", fg: "#7d1a14", label: "Sem desfecho, atrasada" },
  encerrado: { bar: "#a9a49b", bg: "#efeeeb", fg: "#5c5c5c", label: "Encerrado" },
  cancelado: { bar: "#c9c4bb", bg: "#f5f4f1", fg: "#6f6a62", label: "Cancelado" },
};
/** A legenda (Personalizar › Mostrar a legenda): na ordem do dia. */
export const LEGEND: ViewStatus[] = ["marcado", "confirmado", "chegou", "atendendo", "finalizado", "pago", "faltou", "sembaixa"];

type StatusInput = { source: string; status: string; dbStatus: string | null; scheduledAt: string; paid: boolean };
const PLANNED = new Set(["agendado", "confirmado"]);

/** Passou da hora (mais a tolerância de 15 min) e ninguém marcou Chegou: "sem baixa". */
export const isLate = (scheduledAt: string, nowMs: number) => new Date(scheduledAt).getTime() <= nowMs - START_GRACE_MIN * 60_000;

/** O status que a grade mostra. Finalizado só "falta pagar" com o caixa no CRM (com o caixa no Avec, o pagamento é lá). */
export function viewStatus(i: StatusInput, nowMs: number, opts: { caixaOn: boolean } = { caixaOn: false }): ViewStatus {
  const s = i.source === "agendamento" ? i.dbStatus ?? i.status : i.status;
  switch (s) {
    case "solicitado": return "pedido";
    case "agendado": case "confirmado": case "conferir":
      if (isLate(i.scheduledAt, nowMs)) return "sembaixa";
      return s === "confirmado" ? "confirmado" : "marcado";
    case "chegou": return "chegou";
    case "em_atendimento": return "atendendo";
    case "compareceu": return opts.caixaOn && i.source === "agendamento" && !i.paid ? "finalizado" : "pago";
    case "faltou": return "faltou";
    case "cancelado": return "cancelado";
    default: return "encerrado"; // lead remarcou/perdido
  }
}

/** Pendências › Sem baixa olha a semana (P6, 17/10): antes eram só ontem e hoje, e o que passava disso sumia sem baixa. */
export const NO_BAIXA_DAYS = 7;
/** Os 7 dias até hoje (hoje incluído), da meia-noite de Salvador: o período que a Agenda carrega para o Sem baixa. */
export function noBaixaRange(today: string): AgendaRange {
  const day = shiftDay(today, -(NO_BAIXA_DAYS - 1));
  return { day, view: "dia", from: instantOf(day, 0), days: NO_BAIXA_DAYS };
}

/** Os horários sem baixa (da semana, que a tela manda): agendado ou confirmado, já passou da tolerância. Mais antigo primeiro. A CLIENTE PADRÃO do Avec não pede baixa. */
export function noBaixa<T extends { source: string; dbStatus: string | null; scheduledAt: string; noTime: boolean; genericClient?: boolean }>(items: T[], nowMs: number): T[] {
  return items.filter((i) => i.source === "agendamento" && !i.noTime && !i.genericClient && !!i.dbStatus && PLANNED.has(i.dbStatus) && isLate(i.scheduledAt, nowMs))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/** `?destaque=<id>` ("Abrir o horário", a Agenda de hoje do Hoje): o horário já abre, se estiver no dia mostrado. */
export function highlightOpenKey(highlight: string | null, items: { key: string; appointmentId: string | null }[]): string | null {
  return (highlight && items.find((i) => i.appointmentId === highlight)?.key) || null;
}

/* ───────────── Mover (arrastar ou "Mover…") ───────────── */

export type DayHours = { ranges: [number, number][]; off: boolean };
export type PlaceItem = { key: string; source: string; professionalId: string | null; name: string; scheduledAt: string; durationMin: number; status: string; dbStatus: string | null; noTime: boolean;
  serviceId?: string | null; service?: string | null; /** 0089: as auxiliares também ocupam a coluna delas. */ assistants?: { id: string }[] };
export type PlaceCtx = {
  nowMs: number; day: string; today: string;
  /** Horário de trabalho de cada profissional no dia. */ hours: Record<string, DayHours>;
  /** Bloqueios do dia (null = a Casa toda). */ blocks: { professionalId: string | null; start: number; end: number; title: string }[];
  /** Os horários do dia (para achar choque). */ items: PlaceItem[];
  names: Record<string, string>;
  /** Quem faz cada serviço (serviço sem ninguém cadastrado: qualquer uma faz, como no servidor). */ doers?: Record<string, string[]>;
};
export type PlaceResult = { ok: true } | { ok: false; why: string };

const MOVABLE = new Set(["agendado", "confirmado", "solicitado"]);
/** Dá para mover: horário da agenda ainda não começado no sistema (agendado, confirmado ou pedido), com hora. */
export const isMovable = (i: Pick<PlaceItem, "source" | "dbStatus" | "noTime">) => i.source === "agendamento" && !i.noTime && !!i.dbStatus && MOVABLE.has(i.dbStatus);
/** Quem ocupa a coluna (não deixa soltar por cima). */
const FREEING = new Set(["cancelado", "faltou", "remarcou", "perdido", "espera", "espera_encaixada", "espera_desistiu"]);

export const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const firstName = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] || "Ela";
const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;
/** O horário ocupa a coluna de `pro`: ela atende ou é auxiliar dele (0089). */
export const occupies = (x: Pick<PlaceItem, "professionalId" | "assistants">, pro: string | null) => x.professionalId === pro || (!!pro && !!x.assistants?.some((a) => a.id === pro));

/** Pode soltar o horário `item` na coluna `toPro` às `start`? A mesma regra para arrastar e para o "Mover…". */
export function canPlace(item: PlaceItem, toPro: string, start: number, ctx: PlaceCtx): PlaceResult {
  const pro = firstName(ctx.names[toPro]);
  if (!isMovable(item)) return { ok: false, why: "esse horário já começou ou já foi encerrado." };
  const end = start + item.durationMin;
  if (ctx.day < ctx.today) return { ok: false, why: "esse dia já passou." };
  if (ctx.day === ctx.today && start < minuteOfDay(new Date(ctx.nowMs))) return { ok: false, why: "esse horário já passou." };
  if (start < 0 || end > 1440) return { ok: false, why: "passa do fim do dia." };
  const doers = item.serviceId ? ctx.doers?.[item.serviceId] : undefined;
  if (doers?.length && !doers.includes(toPro)) return { ok: false, why: `${pro} não faz ${item.service ? item.service.toLowerCase() : "esse serviço"}.` };
  const h = ctx.hours[toPro];
  if (h?.off) return { ok: false, why: `${pro} está de folga neste dia.` };
  if (h && !h.ranges.some(([a, b]) => a <= start && end <= b)) return { ok: false, why: `fica fora do horário da ${pro}.` };
  const blk = ctx.blocks.find((b) => (b.professionalId === null || b.professionalId === toPro) && overlaps(start, end, b.start, b.end));
  if (blk) return { ok: false, why: `${blk.professionalId ? pro : "a Casa"} tem ${blk.title.toLowerCase()} das ${hm(blk.start)} às ${hm(blk.end)}.` };
  if (item.assistants?.some((a) => a.id === toPro)) return { ok: false, why: `${pro} é auxiliar deste horário.` };
  const clash = ctx.items.find((x) => x.key !== item.key && occupies(x, toPro) && !FREEING.has(x.dbStatus ?? x.status) && !x.noTime
    && overlaps(start, end, minuteOfDay(x.scheduledAt), minuteOfDay(x.scheduledAt) + x.durationMin));
  if (clash) return { ok: false, why: `${pro} já atende ${firstName(clash.name)} às ${hm(minuteOfDay(clash.scheduledAt))}.` };
  return { ok: true };
}

/** Os começos possíveis para o "Mover…": de 15 em 15 min, mostrando as horas cheias e meias e o começo de cada buraco. */
export function placeOptions(item: PlaceItem, toPro: string, ctx: PlaceCtx, range: { start: number; end: number }, limit = 24): number[] {
  const from = item.professionalId === toPro ? minuteOfDay(item.scheduledAt) : -1;
  const ok = (t: number) => t !== from && canPlace(item, toPro, t, ctx).ok;
  const out: number[] = [];
  for (let t = Math.ceil(range.start / 15) * 15; t + item.durationMin <= range.end && out.length < limit; t += 15) {
    if (ok(t) && (t % 30 === 0 || !ok(t - 15))) out.push(t);
  }
  return out;
}

/** O minuto em que o ponteiro solta, pela altura dentro da coluna (encaixa no passo, nunca fora do horário visível). */
export function minuteAt(y: number, pxPerMin: number, range: { start: number; end: number }, snap: number): number {
  const raw = range.start + Math.max(0, y) / pxPerMin;
  const t = range.start + Math.floor((raw - range.start) / snap) * snap;
  return Math.min(Math.max(range.start, t), range.end - snap);
}

/* ───────────── Livres e ocupação ───────────── */

/** Os buracos de pelo menos 30 min no horário de trabalho (hoje, só do agora em diante), sem horários nem bloqueios. */
export function freeGaps(pro: string, ctx: PlaceCtx, min = 30): [number, number][] {
  const h = ctx.hours[pro];
  if (!h || h.off) return [];
  const busy: [number, number][] = [
    ...ctx.items.filter((x) => occupies(x, pro) && !FREEING.has(x.dbStatus ?? x.status) && !x.noTime).map((x) => [minuteOfDay(x.scheduledAt), minuteOfDay(x.scheduledAt) + x.durationMin] as [number, number]),
    ...ctx.blocks.filter((b) => b.professionalId === null || b.professionalId === pro).map((b) => [b.start, b.end] as [number, number]),
  ].sort((a, b) => a[0] - b[0]);
  const from = ctx.day === ctx.today ? Math.ceil(minuteOfDay(new Date(ctx.nowMs)) / 15) * 15 : ctx.day < ctx.today ? 1440 : 0;
  const out: [number, number][] = [];
  for (const [ra, rb] of h.ranges) {
    let cur = Math.max(ra, from);
    for (const [a, b] of busy) {
      if (b <= cur || a >= rb) continue;
      if (a - cur >= min) out.push([cur, a]);
      cur = Math.max(cur, b);
    }
    if (rb - cur >= min) out.push([cur, rb]);
  }
  return out;
}

/** Quanto do horário de trabalho (menos bloqueios) já está marcado, em %. Folga = 0. */
export function occupancy(pro: string, ctx: PlaceCtx): number {
  const h = ctx.hours[pro];
  if (!h || h.off) return 0;
  const work = h.ranges.reduce((s, [a, b]) => s + (b - a), 0);
  const blocked = ctx.blocks.filter((b) => b.professionalId === null || b.professionalId === pro).reduce((s, b) => s + h.ranges.reduce((t, [a, c]) => t + Math.max(0, Math.min(c, b.end) - Math.max(a, b.start)), 0), 0);
  const base = work - blocked;
  if (base <= 0) return 0;
  const used = ctx.items.filter((x) => occupies(x, pro) && !FREEING.has(x.dbStatus ?? x.status) && !x.noTime).reduce((s, x) => s + x.durationMin, 0);
  return Math.min(100, Math.round((used / base) * 100));
}
