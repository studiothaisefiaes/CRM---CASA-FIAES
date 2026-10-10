import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals } from "../db/schema";
import { UserFacingError } from "./errors";
import { emit, logEvent } from "./events";
import { detectOrigin, findOpenDeal, stageByKey } from "./deals";

/**
 * "Iniciar conversa" na ficha do contato. Nunca envia mensagem: só garante que existe um lead aberto para a atendente escrever.
 * - Já tem lead aberto: devolve esse (o índice `deals_one_open_per_contact` garante um só; não troca o dono).
 * - Não tem: cria um novo na etapa Atendimento, com quem iniciou de dona. Lead fechado ou perdido NÃO é reaberto (a venda dele continua nos números).
 * A origem fica sem evidência (canal não é origem): nos relatórios aparece como “Não identificada” até alguém dizer como a cliente conheceu a Casa.
 * - Contato "Não é cliente": recusa. Quem decide voltar é a pessoa, em "Voltar a ser cliente".
 * Duas chamadas ao mesmo tempo (duplo toque, duas abas) terminam no mesmo lead: a linha do contato é travada na transação.
 */
export async function startConversation(contactId: string, userId: string): Promise<{ dealId: string; created: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!c) throw new UserFacingError("Esse contato não existe mais.");
    const existing = await findOpenDeal(c.id, tx);
    if (existing) return { dealId: existing.id, created: false };
    if (c.ignored) throw new UserFacingError("Esse contato está como “Não é cliente”. Volte a ser cliente para iniciar uma conversa.");
    const stage = await stageByKey("atendimento", tx);
    const [d] = await tx.insert(deals).values({ contactId: c.id, stageId: stage.id, ownerId: userId, origin: detectOrigin({ isClient: c.isClient }) }).returning();
    await logEvent(tx, d.id, "lead_criado", { origin: d.origin, initialStage: stage.key, historico: false, iniciadoPelaCasa: true }, userId);
    return { dealId: d.id, created: true };
  });
  if (result.created) await emit("lead_criado", { dealId: result.dealId });
  return result;
}
