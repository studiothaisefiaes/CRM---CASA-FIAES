import { inArray } from "drizzle-orm";
import { db } from "@/server/db";
import { stages } from "@/server/db/schema";

/**
 * Banco como era antes da nova organização (16/10): "Aguardando cliente" e "Fechado" ainda ativas. Para os testes do histórico antigo
 * (relatórios contam Fechado como venda, Quadro e Jornada com a coluna antiga). O seed novo já nasce com as duas desativadas.
 */
export async function etapasAntigasAtivas() {
  await db.update(stages).set({ active: true }).where(inArray(stages.key, ["followup_1", "fechado"]));
}
