import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals } from "../db/schema";
import { whatsapp } from "../whatsapp/evolution";
import { recordOutbound } from "./deals";
import { env } from "../env";

export class SendError extends Error {}

/** Envia texto pelo WhatsApp a partir do card e registra como resposta. */
export async function sendFromCrm(dealId: string, text: string, userId: string) {
  const body = text.trim();
  if (!body) throw new SendError("Escreva uma mensagem antes de enviar.");
  if (body.length > 4000) throw new SendError("Mensagem muito longa (máximo 4.000 caracteres).");
  const [row] = await db.select({ deal: deals, phone: contacts.phoneE164 }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row) throw new SendError("Lead não encontrado.");
  let [channel] = row.deal.channelId
    ? await db.select().from(channels).where(and(eq(channels.id, row.deal.channelId), eq(channels.status, "conectado")))
    : [];
  if (!channel) [channel] = await db.select().from(channels).where(eq(channels.status, "conectado")).limit(1);

  if (!channel) {
    if (env().DEV_TOOLS) {
      // Ambiente de desenvolvimento sem número pareado: registra como "simulado" para testar o fluxo.
      return recordOutbound({ dealId, channelId: null, body, userId, status: "simulado" });
    }
    throw new SendError("Nenhum WhatsApp conectado. Conecte um número em Configurações › WhatsApp.");
  }
  let externalId: string | null = null;
  try {
    ({ externalId } = await whatsapp().sendText(channel.instanceName, row.phone, body));
  } catch (e) {
    throw new SendError(e instanceof Error ? `Não foi possível enviar: ${e.message}` : "Não foi possível enviar.");
  }
  return recordOutbound({ dealId, channelId: channel.id, externalId, body, userId, status: "sent" });
}
