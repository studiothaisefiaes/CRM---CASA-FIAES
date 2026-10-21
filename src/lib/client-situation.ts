import { dueLabel } from "./next-action";
import { firstName } from "./authorship";
import { BIRTHDAY_WEEK_DAYS, addDaysTo, bahiaDay, daysBetween, daysUntilBirthday, displayName, returnInfo, shortDay, type ReturnInfo } from "./client-rhythm";

/**
 * A situação da cliente em uma frase (spec Lote 2, bloco 2), montada no servidor e repetida na ficha, no painel da conversa e na lista.
 * Ex.: "Tem horário amanhã 14:00 com Maiara · pacote 3/4 · última visita há 20 dias · na etapa Aguardando cliente há 2 h com Sara".
 */
export type SituationState = "sem_dono" | "atrasada" | "sumida" | "na_hora_de_voltar" | "aniversario";
export const SITUATION_STATE_LABEL: Record<SituationState, string> = {
  sem_dono: "Sem dono", atrasada: "Atrasada", sumida: "Sumida", na_hora_de_voltar: "Hora de voltar", aniversario: "Aniversário nesta semana",
};

export type SituationInput = {
  lastVisitOn: string | null; rhythmDays: number | null; cycleDays: number | null;
  /** O próximo horário marcado (até 180 dias); quem chama já cortou as datas absurdas. */
  nextAppointment: { startsAt: string; professionalName: string | null } | null;
  activePackage: { usedSessions: number; totalSessions: number } | null;
  /** A conversa aberta: etapa, dona, desde quando está na etapa, desde quando espera a Casa e se tem alerta de atraso aberto. */
  conversation: { stageName: string; stageKind: string; ownerName: string | null; enteredAt: string; awaitingSince: string | null; late: boolean } | null;
  birthday: { day: number; month: number } | null;
};
export type Situation = { sentence: string; short: string; states: SituationState[]; retorno: ReturnInfo | null };

function ago(fromMs: number, nowMs: number): string {
  const min = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  return `${d} ${d === 1 ? "dia" : "dias"}`;
}
const conversationLabel = (kind: string, name: string) =>
  kind === "lead" ? "conversa nova" : kind === "atendimento" ? "em conversa" : `na etapa ${name}`;

export function clientSituation(i: SituationInput, nowMs: number): Situation {
  const today = bahiaDay(nowMs);
  const retorno = returnInfo({ lastVisitOn: i.lastVisitOn, rhythmDays: i.rhythmDays, cycleDays: i.cycleDays, hasFuture: !!i.nextAppointment }, today);
  const states: SituationState[] = [];
  const parts: string[] = [];

  let appt: string | null = null;
  if (i.nextAppointment) {
    const pro = displayName(i.nextAppointment.professionalName);
    appt = `Tem horário ${dueLabel(Date.parse(i.nextAppointment.startsAt), nowMs)}${pro ? ` com ${pro}` : ""}`;
    parts.push(appt);
  }
  if (i.activePackage) parts.push(`pacote ${i.activePackage.usedSessions}/${i.activePackage.totalSessions}`);

  const days = i.lastVisitOn ? Math.max(0, daysBetween(i.lastVisitOn, today)) : null;
  const visit = days == null ? "ainda não veio à Casa" : days === 0 ? "veio hoje" : days === 1 ? "última visita ontem" : `última visita há ${days} dias`;
  parts.push(visit);

  if (i.conversation) {
    const c = i.conversation;
    const who = c.ownerName ? ` com ${firstName(c.ownerName)}` : ", sem dono";
    parts.push(c.awaitingSince
      ? `esperando resposta da Casa há ${ago(Date.parse(c.awaitingSince), nowMs)}${who}`
      : `${conversationLabel(c.stageKind, c.stageName)} há ${ago(Date.parse(c.enteredAt), nowMs)}${who}`);
    if (!c.ownerName) states.push("sem_dono");
    if (c.late) states.push("atrasada");
  }

  let back: string | null = null;
  if (retorno?.status === "na_hora") { back = "Hora de voltar"; states.push("na_hora_de_voltar"); parts.push(`hora de voltar (prevista ${shortDay(retorno.dueOn, today)})`); }
  if (retorno?.status === "sumida") { back = "Sumida"; states.push("sumida"); parts.push(`sumida (volta prevista ${shortDay(retorno.dueOn, today)}, atrasada ${retorno.lateDays} dias)`); }

  if (i.birthday) {
    const n = daysUntilBirthday(i.birthday.day, i.birthday.month, today);
    if (n <= BIRTHDAY_WEEK_DAYS) {
      states.push("aniversario");
      parts.push(n === 0 ? "aniversário hoje" : n === 1 ? "aniversário amanhã" : `aniversário ${shortDay(addDaysTo(today, n), today)}`);
    }
  }

  // Frase curta (coluna "Situação" da lista e faixa da conversa): o mais urgente primeiro, no máximo 2 pedaços.
  const late = i.conversation?.late ? "Esperando resposta, atrasada" : null;
  const noOwner = i.conversation && !i.conversation.ownerName ? "Sem dono" : null;
  const short = [late, appt, back, noOwner, visit].filter((x): x is string => !!x).slice(0, 2).join(" · ");
  return { sentence: parts.join(" · "), short, states, retorno };
}
