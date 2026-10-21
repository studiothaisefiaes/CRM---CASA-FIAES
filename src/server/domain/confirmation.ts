import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "../db";
import { deals, stages, tasks } from "../db/schema";
import { parseConfirmation } from "@/lib/confirmation";
import { completeTaskTx } from "./tasks";

/** Combinado que a confirmação resolve: "Remarcar com…", "Confirmar horário…". */
const CLOSES = /remarcar|confirmar/i;

/**
 * A Casa mandou a confirmação padrão ("Confirmado agendamento … dia 17/10 … às 9h"): marca Agendado com o dia e a hora sozinho e fecha o
 * combinado de remarcar/confirmar (caso Wanda Rezende, 15/10). Só mensagem ENVIADA pela Casa, nunca automática; horário que já passou e
 * conversa fechada, perdida ou arquivada não mudam. Devolve se mexeu.
 */
export async function applyConfirmationTx(tx: Tx, dealId: string, body: string | null | undefined, at: Date, userId: string | null): Promise<boolean> {
  const when = parseConfirmation(body, at.getTime());
  if (!when || when.getTime() <= at.getTime()) return false;
  const [d] = await tx.select({ scheduledAt: deals.scheduledAt, closedAt: deals.closedAt, archivedAt: deals.archivedAt, kind: stages.kind })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
  if (!d || d.closedAt || d.archivedAt || d.kind === "fechado" || d.kind === "perdido") return false;
  // Import na hora: updates.ts e deals.ts importam este módulo pelo caminho do envio.
  const [{ updateDealTx }, { moveToKindTx }] = await Promise.all([import("./updates"), import("./deals")]);
  if (d.scheduledAt?.getTime() !== when.getTime()) await updateDealTx(tx, dealId, { scheduledAt: when.toISOString() }, userId);
  if (d.kind !== "agendado") await moveToKindTx(tx, dealId, "agendado", userId, "confirmacao", at);
  const open = await tx.select({ id: tasks.id, title: tasks.title }).from(tasks)
    .where(and(eq(tasks.dealId, dealId), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt)));
  for (const t of open) if (CLOSES.test(t.title)) await completeTaskTx(tx, t.id, userId, "concluida", at);
  return true;
}
