import { and, eq, isNull, notLike, sql } from "drizzle-orm";
import type { Tx } from "../db";
import { alerts } from "../db/schema";

/**
 * A conversa mudou de dona (assumir, transferir, devolver à fila, distribuir): o alerta de atraso da espera em aberto vai junto
 * (nível 1). Sem dona, o alerta passa para a gestão. O nível 2 (escalado) já é da gestão e fica como está.
 */
export async function reassignWaitAlerts(tx: Tx, dealId: string, ownerId: string | null): Promise<void> {
  await tx.update(alerts).set(ownerId ? { userId: ownerId, audience: "responsavel", readAt: null, pushedAt: null } : { userId: null, audience: "gestao", readAt: null, pushedAt: null })
    .where(and(eq(alerts.dealId, dealId), isNull(alerts.resolvedAt), eq(alerts.level, 1), sql`${alerts.waitKey} is not null`,
      notLike(alerts.waitKey, "task:%"), notLike(alerts.waitKey, "oferta:%")));
}
