import { eq } from "drizzle-orm";
import { db } from "../db";
import { stages } from "../db/schema";
import { UserFacingError } from "./updates";

/** Etapas que exigem dados (data, valor e pagamento, motivo): só entram pela ação própria (agendar, fechar venda, perdido). */
export const OWN_ACTION_STAGE_KINDS = ["agendado", "fechado", "perdido"] as const;

/**
 * Mover "solto" (Quadro, painel, desfazer) não pode cair nessas etapas: o lead ficaria Fechado sem valor, Agendado sem data ou Perdido sem motivo.
 * Etapa que não existe passa daqui e falha em `moveDeal` com o erro de sempre.
 */
export async function assertDirectMove(stageKey: string): Promise<void> {
  const [s] = await db.select({ kind: stages.kind }).from(stages).where(eq(stages.key, stageKey)).limit(1);
  if (s && (OWN_ACTION_STAGE_KINDS as readonly string[]).includes(s.kind)) throw new UserFacingError("Use a ação própria");
}
