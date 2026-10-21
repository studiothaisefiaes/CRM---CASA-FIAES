import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, channels, contacts, deals, messages } from "../db/schema";
import { isHiddenNumber } from "@/lib/phone-client";
import { whatsapp } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";
import { UserFacingError } from "./errors";
import { resolveChannel } from "./send";
import { emit } from "./events";

/** O WhatsApp só apaga para todos mensagens recentes (hoje, cerca de 2 dias e meio). Mais velha que isso nem tenta. */
export const DELETE_FOR_EVERYONE_MAX_MS = 60 * 3_600_000;
const TOO_OLD = "Não deu para apagar para todos: o WhatsApp só deixa apagar mensagens recentes (até uns 2 dias).";

/**
 * "Apagar para todos" (17/10: a cliente recebeu duas mensagens, uma do ChatGuru e uma do CRM, e a equipe apagou no celular).
 * Vale para mensagem ENVIADA pelo número da Casa, saia ela do CRM, do celular ou do ChatGuru. Pede à Evolution para apagar no WhatsApp
 * e só então marca apagada no CRM ("Mensagem apagada" na conversa) e registra quem apagou. Se o WhatsApp recusar, nada muda e o
 * motivo vem em texto claro.
 */
export async function deleteForEveryone(messageId: string, userId: string, now = new Date()): Promise<void> {
  const [m] = await db.select({ msg: messages, phone: contacts.phoneE164 }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId)).where(eq(messages.id, messageId));
  if (!m) throw new UserFacingError("Mensagem não encontrada.");
  const msg = m.msg;
  if (msg.direction !== "out" || msg.kind === "nota" || msg.kind === "call") throw new UserFacingError("Só dá para apagar mensagens enviadas pela Casa.");
  if (msg.deletedAt) throw new UserFacingError("Essa mensagem já foi apagada.");
  if (msg.importedAt) throw new UserFacingError("Essa mensagem foi importada do histórico: apague pelo celular.");
  if (!msg.externalId || msg.status === "pending" || msg.status === "failed") throw new UserFacingError("Essa mensagem não chegou ao WhatsApp: não há o que apagar para a cliente.");
  if (isHiddenNumber(m.phone)) throw new UserFacingError("Essa cliente está com o número oculto no WhatsApp. Apague pelo celular do salão.");
  if (now.getTime() - msg.createdAt.getTime() > DELETE_FOR_EVERYONE_MAX_MS) throw new UserFacingError(TOO_OLD);

  // O número por onde a mensagem saiu; sem ele (mensagem antiga), o da conversa.
  let channel = msg.channelId ? (await db.select().from(channels).where(eq(channels.id, msg.channelId)))[0] ?? null : null;
  if (!channel || channel.status !== "conectado") {
    const [deal] = msg.dealId ? await db.select().from(deals).where(eq(deals.id, msg.dealId)) : [];
    channel = deal ? await resolveChannel(deal.id, deal) : null;
  }
  const provider = whatsapp();
  if (channel && !provider.deleteForEveryone) throw new UserFacingError("Este WhatsApp não permite apagar pelo CRM. Apague pelo celular.");
  if (channel) {
    try { await provider.deleteForEveryone!(channel.instanceName, m.phone, msg.externalId); }
    catch (e) {
      if (!(e instanceof ProviderError)) throw e;
      throw new UserFacingError(e.status ? "Não deu para apagar para todos: o WhatsApp recusou. Ele só deixa apagar mensagens recentes; se ela for de hoje, tente pelo celular."
        : "Não deu para apagar para todos: o WhatsApp não respondeu. Tente de novo em instantes.");
    }
  }
  await db.update(messages).set({ deletedAt: now }).where(eq(messages.id, msg.id));
  await db.insert(auditLog).values({ userId, action: "apagou_para_todos", entity: "message", entityId: msg.id, data: { dealId: msg.dealId }, createdAt: now });
  if (msg.dealId) await emit("mensagem_atualizada", { dealId: msg.dealId });
}

/**
 * "Apagar só aqui" (20/10): tira a mensagem da conversa no CRM (recebida, enviada, nota ou ligação), sem mexer no WhatsApp da cliente.
 * Some da conversa e deixa de contar como não lida; fica registrado quem tirou.
 */
export async function hideMessage(messageId: string, userId: string, now = new Date()): Promise<void> {
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!msg) throw new UserFacingError("Mensagem não encontrada.");
  if (msg.hiddenAt) return;
  await db.update(messages).set({ hiddenAt: now, deletedAt: msg.deletedAt ?? now }).where(eq(messages.id, msg.id));
  await db.insert(auditLog).values({ userId, action: "apagou_so_no_crm", entity: "message", entityId: msg.id, data: { dealId: msg.dealId, direction: msg.direction, kind: msg.kind }, createdAt: now });
  if (msg.dealId) await emit("mensagem_atualizada", { dealId: msg.dealId });
}
