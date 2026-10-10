import { businessSecondsBetween, type BusinessHours } from "./business-hours";
import { seconds } from "./format";
import { ringState, slaProgress, type RingState } from "./queue";
import type { BoardUrgency } from "./board-order";

const TZ = "America/Bahia";
const MIN = 60_000, H = 3_600_000, D = 86_400_000;

/** "há 3 dias", "há 5 h", "há 10 min"; menos de um minuto é "agora". */
export function agoLabel(ms: number): string {
  if (ms < MIN) return "agora";
  if (ms < H) return `há ${Math.floor(ms / MIN)} min`;
  if (ms < D) return `há ${Math.floor(ms / H)} h`;
  const days = Math.floor(ms / D);
  return `há ${days} ${days === 1 ? "dia" : "dias"}`;
}

const parts = (ms: number) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, weekday: "short", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { weekday: p.weekday.replace(".", "").toLowerCase(), day: p.day, month: p.month, hour: Number(p.hour), minute: Number(p.minute) };
};
/** O dia civil em Salvador, como número comparável. */
const dayNumber = (ms: number) => Math.floor((ms - 3 * H) / D);

/** "ter 15h", "hoje 17h", "amanhã 10h"; daqui a mais de uma semana, "20/10 15h". Sempre no horário de Salvador. */
export function scheduleLabel(iso: string, now: number): string {
  const at = new Date(iso).getTime();
  const p = parts(at);
  const time = p.minute ? `${p.hour}h${String(p.minute).padStart(2, "0")}` : `${p.hour}h`;
  const diff = dayNumber(at) - dayNumber(now);
  if (diff === 0) return `hoje ${time}`;
  if (diff === 1) return `amanhã ${time}`;
  if (diff > 1 && diff < 7) return `${p.weekday} ${time}`;
  return `${p.day}/${p.month} ${time}`;
}

export type StatusInput = {
  stageKind: string; awaitingSince: string | null; urgency: BoardUrgency; slaMinutes: number | null; scheduledAt: string | null; closedAt: string | null;
};

/**
 * O que a Jornada diz de cada pessoa, o mesmo texto no rótulo visível e no `aria-label`.
 * Fechado e Perdido dizem há quanto tempo e não têm anel de prazo (já terminaram). Com a cliente esperando resposta vale a espera (é o que pede ação);
 * sem espera, Agendado mostra o horário marcado e as demais etapas dizem "com a cliente".
 */
export function personStatus(p: StatusInput, now: number, hours: BusinessHours): { text: string; ring: RingState; progress: number } {
  if (p.stageKind === "fechado" || p.stageKind === "perdido") {
    const when = p.closedAt ? agoLabel(now - new Date(p.closedAt).getTime()) : "";
    return { text: `${p.stageKind === "fechado" ? "fechou" : "perdido"} ${when}`.trim(), ring: "none", progress: 0 };
  }
  if (p.awaitingSince) {
    const wait = businessSecondsBetween(new Date(p.awaitingSince).getTime(), now, hours);
    const ring = ringState({ awaiting: true, late: p.urgency === "late", waitSeconds: wait, slaMinutes: p.slaMinutes });
    return { text: ring === "late" ? `atrasado · ${seconds(wait)}` : seconds(wait), ring, progress: ring === "late" ? 1 : slaProgress(wait, p.slaMinutes) };
  }
  if (p.stageKind === "agendado") return { text: p.scheduledAt ? `agendado para ${scheduleLabel(p.scheduledAt, now)}` : "agendado", ring: "none", progress: 0 };
  return { text: "com a cliente", ring: "none", progress: 0 };
}
