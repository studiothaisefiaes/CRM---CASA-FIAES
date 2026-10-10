import { getBoard, type BoardCard, type BoardStage } from "./board";
import { formatPhone } from "../domain/phone";
import { orderByUrgency, type BoardUrgency } from "../../lib/board-order";

/** Quantas pessoas cada estação mostra; o resto vira "+N". */
export const JOURNEY_PEOPLE_MAX = 12;

export type JourneyPerson = {
  dealId: string; name: string; contactId: string; hasAvatar: boolean;
  /** Desde quando a cliente espera resposta (ISO); null quando a bola não está com a Casa. */
  awaitingSince: string | null;
  urgency: BoardUrgency; slaMinutes: number | null;
};
export type JourneyStation = {
  /** Chave da etapa (`etapa=` da Fila). Follow-up 1 a 4 formam uma estação só: "followup". */
  key: string; name: string; kind: string; color: string; count: number;
  /** Leads com alerta de espera aberto (a mesma regra do sino, da Fila e do Quadro). */
  late: number;
  people: JourneyPerson[]; /** Quantos passaram do limite e viram "+N". */ more: number;
};
export type Journey = { stations: JourneyStation[] };

const nameOf = (c: BoardCard) => c.contactName?.trim() || formatPhone(c.phone);

/** Agrupa as etapas de follow-up numa estação só (como o Quadro faz), na posição da primeira. */
function toStations(board: BoardStage[]): { key: string; name: string; kind: string; color: string; cards: BoardCard[] }[] {
  const out: ReturnType<typeof toStations> = [];
  for (const s of board) {
    if (s.kind !== "followup") { out.push({ key: s.key, name: s.name, kind: s.kind, color: s.color, cards: s.cards }); continue; }
    const existing = out.find((o) => o.key === "followup");
    if (existing) existing.cards = [...existing.cards, ...s.cards];
    else out.push({ key: "followup", name: "Follow-up", kind: "followup", color: s.color, cards: [...s.cards] });
  }
  return out;
}

/**
 * A Jornada da gestão: cada etapa é uma estação com a contagem, quantos estão atrasados e as pessoas que estão ali (até 12, os mais urgentes primeiro).
 * Sai do próprio Quadro (`getBoard`, visão da gestão), então as contagens batem: mesmos leads, mesmos filtros, mesma regra de atraso.
 * Quem chama garante que é gestão (a rota `/jornada` confere a sessão).
 */
export async function getJourney(now = new Date()): Promise<Journey> {
  const board = await getBoard({}, { id: "", role: "gestor" }, now);
  const slaByStage = new Map(board.map((s) => [s.id, s.slaMinutes]));
  return {
    stations: toStations(board).map((s) => {
      // O Quadro já ordena cada etapa; ao juntar os follow-ups a ordem é refeita pela mesma regra.
      const cards = s.kind === "followup" ? orderByUrgency(s.cards) : s.cards;
      return {
        key: s.key, name: s.name, kind: s.kind, color: s.color, count: cards.length, late: cards.filter((c) => c.urgency === "late").length,
        people: cards.slice(0, JOURNEY_PEOPLE_MAX).map((c) => ({
          dealId: c.id, name: nameOf(c), contactId: c.contactId, hasAvatar: c.hasAvatar, awaitingSince: c.awaitingReplySince, urgency: c.urgency, slaMinutes: slaByStage.get(c.stageId) ?? null,
        })),
        more: Math.max(0, cards.length - JOURNEY_PEOPLE_MAX),
      };
    }),
  };
}
