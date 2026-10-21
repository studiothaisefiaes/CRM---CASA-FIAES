import { businessMinutesBetween, isOpen, windowOfInstant, type BusinessHours } from "./business-hours";
import { dueLabel } from "./next-action";
import { answeredText } from "./alert-copy";

/** O que a conversa precisa saber do lead para explicar a espera. */
export type WhyLateItem = {
  /** Desde quando a cliente espera resposta (ISO); null = a bola não está com a Casa. */
  awaitingSince: string | null;
  slaMinutes: number | null;
  /** Última mensagem da conversa (para o caso "aguardando a cliente"). */
  lastAt?: string | null;
  lastDirection?: "in" | "out" | null;
  /** Quem mandou a última mensagem da Casa (nome; null = sem autora registrada) e se saiu pelo celular. */
  lastBy?: string | null;
  lastFromPhone?: boolean;
};

const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão
const DAY_MS = 86_400_000;
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const WEEKDAY_SHORT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

/** Relógio de parede de Salvador: o dia (índice desde 1970), o dia da semana e minutos desde 00:00. */
const wall = (ms: number) => {
  const d = new Date(ms - OFFSET_MS);
  return { day: Math.floor((ms - OFFSET_MS) / DAY_MS), dow: d.getUTCDay(), h: d.getUTCHours(), m: d.getUTCMinutes() };
};
const hhmm = (ms: number) => { const w = wall(ms); return `${String(w.h).padStart(2, "0")}:${String(w.m).padStart(2, "0")}`; };
/** "hoje" ou o dia da semana ("sexta"): o texto da Casa fechada diz "desde sexta 19:40", mesmo na manhã seguinte. */
const dayWord = (ms: number, now: number) => (wall(now).day === wall(ms).day ? "hoje" : WEEKDAY[wall(ms).dow]);

/** Próxima abertura da Casa depois de `now`: em quantos dias (0 = hoje), o dia da semana e a hora. null se nunca abre. */
function nextOpeningAt(now: number, hours: BusinessHours): { days: number; dow: number; h: number; m: number } | null {
  const today = wall(now);
  for (let i = 0; i <= 7; i++) {
    const dow = (today.dow + i) % 7;
    const win = windowOfInstant(now + i * DAY_MS, hours);
    if (!win) continue;
    const [h, m] = win[0].split(":").map(Number);
    if (i === 0 && h * 60 + m <= today.h * 60 + today.m) continue; // já passou da abertura de hoje
    return { days: i, dow, h, m };
  }
  return null;
}
const dayName = (o: { days: number; dow: number }) => (o.days === 0 ? "hoje" : o.days === 1 ? "amanhã" : WEEKDAY_SHORT[o.dow]);

/** "hoje 8:00", "amanhã 8:00", "seg 8:00". null se nunca abre. */
function nextOpening(now: number, hours: BusinessHours): string | null {
  const o = nextOpeningAt(now, hours);
  return o ? `${dayName(o)} ${o.h}:${String(o.m).padStart(2, "0")}` : null;
}

/** Linha da Fila com a Casa fechada (no lugar do prazo, que não anda): "Casa abre às 8h", "Casa abre amanhã às 8h", "Casa abre seg às 9h30". */
export function opensText(now: number, hours: BusinessHours): string {
  const o = nextOpeningAt(now, hours);
  if (!o) return "Casa fechada";
  const at = `${o.h}h${o.m ? String(o.m).padStart(2, "0") : ""}`;
  return o.days === 0 ? `Casa abre às ${at}` : `Casa abre ${dayName(o)} às ${at}`;
}

const minutesText = (min: number) => (min < 1 ? "menos de 1 min" : min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`);

/**
 * Por que o lead está esperando, em uma linha: serve ao painel do cliente (e ao ⋯ do celular).
 * Pura: o horário de expediente e o relógio vêm de fora.
 * - esperando com a Casa aberta: quando a cliente escreveu, quanto do tempo é de expediente e o prazo;
 * - esperando com a Casa fechada: desde quando está sem resposta e quando a Casa reabre;
 * - sem espera: a bola está com a cliente; diz quem respondeu por último, quando (sempre com o dia) e se foi pelo celular.
 */
export function whyLate(item: WhyLateItem, hours: BusinessHours, now: Date | number): string {
  const nowMs = typeof now === "number" ? now : now.getTime();
  if (!item.awaitingSince) {
    if (item.lastDirection === "out" && item.lastAt) return answeredText({ by: item.lastBy ?? null, fromPhone: !!item.lastFromPhone, at: dueLabel(new Date(item.lastAt).getTime(), nowMs) });
    return "Agora é a vez da cliente.";
  }
  const since = new Date(item.awaitingSince).getTime();
  if (!isOpen(nowMs, hours)) {
    const reopen = nextOpening(nowMs, hours);
    return `Sem resposta da Casa desde ${dayWord(since, nowMs)} ${hhmm(since)} — Casa fechada${reopen ? ` até ${reopen}` : ""}`;
  }
  const day = dayWord(since, nowMs);
  const when = day === "hoje" ? `às ${hhmm(since)}` : `${day} às ${hhmm(since)}`;
  const waited = minutesText(businessMinutesBetween(since, nowMs, hours));
  return `Cliente escreveu ${when} e ninguém respondeu (${waited} no expediente${item.slaMinutes ? `; prazo ${item.slaMinutes} min` : ""})`;
}
