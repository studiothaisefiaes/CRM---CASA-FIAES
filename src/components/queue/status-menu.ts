import type { DealDetail } from "@/server/queries/deal";
import type { MenuItem } from "@/components/ui/menu";
import { CONVERSATION_STATUSES, conversationStatus, RETOMAR_LABEL, retomarWhen, STATUS_HINT, STATUS_LABEL, type ConversationStatus } from "@/lib/conversation-status";
import type { LeadActions } from "./use-lead-actions";
import { useClock, useHours } from "@/components/pipeline/timer";
import { lateNow } from "@/lib/queue";

/** O status da conversa agora (Aberto / Aguardando / Resolvido) e se o Aberto já passou do prazo (a mesma regra da linha da Fila). */
export function usePaneStatus(d: DealDetail): { status: ConversationStatus; late: boolean } {
  const hours = useHours();
  const status = conversationStatus({ archivedAt: d.deal.conversationArchivedAt, awaitingSince: d.deal.awaitingReplySince });
  const since = d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).getTime() : null;
  const late = useClock((now) => status === "aberto" && lateNow({ alert: d.late, since, slaMinutes: d.stage.slaMinutes }, now, hours), since ?? 0);
  return { status, late };
}

export { RETOMAR_COLOR, RETOMAR_LABEL } from "@/lib/conversation-status";
/** O "Para retomar" da conversa aberta no painel (ver `retomarWhen`). */
export function retomarOf(d: Pick<DealDetail, "nextAction" | "deal">, _status?: ConversationStatus): string | null {
  const last = Math.max(...[d.deal.lastInboundAt, d.deal.lastOutboundAt].map((x) => (x ? new Date(x).getTime() : 0)));
  return retomarWhen({ awaitingSince: d.deal.awaitingReplySince, dueAt: d.nextAction?.dueAt ?? null, lastAt: last ? new Date(last) : null });
}

/** As escolhas do status, com a atual marcada (cabeçalho e ⋯ do celular). Resolvido = o antigo Encerrar. "Para retomar" abre o Retomar (data e lembrete). */
export function statusItems(current: ConversationStatus, actions: LeadActions, retomar: string | null = null): MenuItem[] {
  const base = CONVERSATION_STATUSES.map((s) => ({ label: STATUS_LABEL[s], detail: STATUS_HINT[s], current: s === current && !retomar, onSelect: () => { if (s !== current) actions.setStatus(s); } }));
  const retomarItem: MenuItem = { label: RETOMAR_LABEL, detail: retomar ? `Lembrete ${retomar}. Toque para mudar a data.` : "A Casa já respondeu e vai voltar a falar numa data: escolha o dia e vira lembrete à parte. Não some como o Resolvido.",
    current: !!retomar, onSelect: () => actions.openResume() };
  return [base[0], base[1], retomarItem, base[2]];
}

