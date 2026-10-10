import { NEAR_SLA_RATIO, slaProgress } from "./queue";

/** Ordem de urgência do Quadro, a mesma ideia da Fila: atrasado, perto do prazo, aguardando resposta, o resto (a bola está com a cliente). */
export type BoardUrgency = "late" | "near" | "waiting" | "idle";
const RANK: Record<BoardUrgency, number> = { late: 0, near: 1, waiting: 2, idle: 3 };

/**
 * `late` é do alerta de espera aberto (a mesma regra do sino e da Fila, ver `late-count.ts`). `near` é a partir de NEAR_SLA_RATIO do prazo da etapa,
 * contado em horas de expediente (`waitSeconds` já vem assim do servidor).
 */
export function boardUrgency(o: { late: boolean; awaiting: boolean; waitSeconds: number; slaMinutes: number | null }): BoardUrgency {
  if (o.late) return "late";
  if (!o.awaiting) return "idle";
  return o.slaMinutes && slaProgress(o.waitSeconds, o.slaMinutes) >= NEAR_SLA_RATIO ? "near" : "waiting";
}

export type UrgencyCard = { id: string; urgency: BoardUrgency; waitSeconds: number; lastMessageAt: string | null; stageEnteredAt: string };
const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export function compareUrgency(a: UrgencyCard, b: UrgencyCard): number {
  if (a.urgency !== b.urgency) return RANK[a.urgency] - RANK[b.urgency];
  // Quem espera há mais tempo primeiro; entre os que não esperam, a conversa mais recente.
  const byTime = a.urgency === "idle" ? time(b.lastMessageAt ?? b.stageEnteredAt) - time(a.lastMessageAt ?? a.stageEnteredAt) : b.waitSeconds - a.waitSeconds;
  return byTime || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export const orderByUrgency = <T extends UrgencyCard>(cards: readonly T[]): T[] => [...cards].sort(compareUrgency);
