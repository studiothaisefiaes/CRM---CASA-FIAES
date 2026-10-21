import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { saveVirada } from "@/server/domain/virada";
import { VIRADA_ITENS, type ViradaAlvo } from "@/lib/virada";

/**
 * A Virada feita (Task 10), para os testes que ligam o lembrete ou o Depois do atendimento: um teste de verdade gravado agora
 * (audit `teste_virada`, com o modo no Depois do atendimento) e todos os itens do checklist marcados. Não envia nada.
 */
export async function fazerVirada(alvo: ViradaAlvo, userId: string, modo?: "agradecimento" | "pesquisa"): Promise<void> {
  const now = new Date();
  await db.insert(auditLog).values({ userId, action: "teste_virada", entity: "virada", entityId: alvo, data: modo ? { modo } : {}, createdAt: now });
  await saveVirada(alvo, [...VIRADA_ITENS[alvo]], userId, now);
}
