import { markWaitingForClient } from "./funnel";
import { UserFacingError } from "./errors";

/**
 * "Retomar depois" (pedido da Casa, 14/10) é o "Marcar como aguardando cliente" com data (Lote 1C): Aguardando cliente com a
 * tentativa 1 no dia e no motivo escolhidos; a espera e os avisos se resolvem. Agendado continua agendado (só o lembrete).
 */
export async function resumeLater(dealId: string, input: { title: string; dueAt: Date; assigneeId?: string | null }, userId: string | null, now = new Date()) {
  if (!input.title.trim()) throw new UserFacingError("Escreva o que precisa ser feito.");
  await markWaitingForClient(dealId, { resumeAt: input.dueAt, title: input.title, assigneeId: input.assigneeId }, userId, now);
}
