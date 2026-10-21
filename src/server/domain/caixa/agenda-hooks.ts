import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import { comandaItems, comandas } from "../../db/schema";
import { UserFacingError } from "../errors";
import { reverseLoyaltyTx } from "../fidelidade";

/** Itens vivos (não cancelados) de horários, numa comanda com o status dado. */
const linked = (tx: Tx, ids: string[], status: "aberta" | "fechada") =>
  tx.select({ id: comandaItems.id, comandaId: comandaItems.comandaId }).from(comandaItems).innerJoin(comandas, eq(comandas.id, comandaItems.comandaId))
    .where(and(inArray(comandaItems.appointmentId, ids), isNull(comandaItems.cancelledAt), eq(comandas.status, status)));

/** 7.5: visita paga não se cancela pela Agenda; a gestão cancela a comanda antes. */
export async function assertNotPaidTx(tx: Tx, appointmentIds: string[]): Promise<void> {
  if (appointmentIds.length && (await linked(tx, appointmentIds, "fechada")).length) throw new UserFacingError("Essa visita já foi paga. Cancele a comanda antes (gestão).");
}

/** 7.5: "item de horário cancelado com a comanda aberta: o item sai sozinho". Devolve quantos saíram. */
export async function dropOpenItemsTx(tx: Tx, appointmentIds: string[], actorId: string | null, now: Date): Promise<number> {
  if (!appointmentIds.length) return 0;
  const rows = await linked(tx, appointmentIds, "aberta");
  const ids = rows.map((r) => r.id);
  if (!ids.length) return 0;
  await tx.update(comandaItems).set({ cancelledAt: now, cancelledBy: actorId }).where(inArray(comandaItems.id, ids));
  // Fidelidade: como tirar o item na comanda (o prêmio usado volta; o ponto que ficou na comanda reaberta sai).
  for (const r of rows) await reverseLoyaltyTx(tx, r.comandaId, { itemId: r.id, actorId, now });
  await tx.update(comandas).set({ updatedAt: now }).where(sql`${comandas.id} in (select ${comandaItems.comandaId} from ${comandaItems} where ${inArray(comandaItems.id, ids)})`);
  return ids.length;
}

/** Desfazer o Finalizado de uma visita paga mudaria o que a comanda prova: só cancelando a comanda (gestão). */
export async function assertUndoAllowedTx(tx: Tx, appointmentId: string): Promise<void> {
  if ((await linked(tx, [appointmentId], "fechada")).length) throw new UserFacingError("Essa visita já foi paga: para mudar, a gestão cancela a comanda.");
}
