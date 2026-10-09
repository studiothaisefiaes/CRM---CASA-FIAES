import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, contacts, deals, messages } from "../db/schema";
import { whatsapp } from "../whatsapp/evolution";
import { recordOutbound } from "./deals";
import { emit } from "./events";
import { env } from "../env";

export class SendError extends Error {}

/**
 * Envia texto pelo WhatsApp a partir do card.
 * 1) grava a mensagem como "enviando" (com quem enviou), 2) chama a Evolution, 3) confirma e registra como resposta.
 * Se falhar, a mensagem fica marcada como "falhou" na conversa e o lead continua esperando resposta.
 */
export async function sendFromCrm(dealId: string, text: string, userId: string) {
  const body = text.trim();
  if (!body) throw new SendError("Escreva uma mensagem antes de enviar.");
  if (body.length > 4000) throw new SendError("Mensagem muito longa (máximo 4.000 caracteres).");
  const [row] = await db.select({ deal: deals, phone: contacts.phoneE164 }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row) throw new SendError("Lead não encontrado.");

  // Responde sempre pelo mesmo número em que a cliente escreveu.
  let channel = row.deal.channelId ? (await db.select().from(channels).where(eq(channels.id, row.deal.channelId)))[0] : undefined;
  if (channel && channel.status !== "conectado") {
    // O mesmo número pode ter sido lido de novo em outro canal: responde por ele e o lead passa a usar esse canal.
    const same = channel.phone ? (await db.select().from(channels).where(and(eq(channels.phone, channel.phone), eq(channels.status, "conectado"))).limit(1))[0] : undefined;
    if (!same) throw new SendError(`O WhatsApp "${channel.name}" está desconectado. Leia o QR code de novo em Configurações › WhatsApp.`);
    channel = same;
    await db.update(deals).set({ channelId: same.id }).where(eq(deals.id, dealId));
  }
  if (!channel) channel = (await db.select().from(channels).where(eq(channels.status, "conectado")).limit(1))[0];

  if (!channel) {
    if (env().DEV_TOOLS) return recordOutbound({ dealId, channelId: null, body, userId, status: "simulado" });
    throw new SendError("Nenhum WhatsApp conectado. Conecte um número em Configurações › WhatsApp.");
  }

  const [pending] = await db.insert(messages).values({
    dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: "text", body, status: "pending", sentByUserId: userId,
  }).returning({ id: messages.id });
  await emit("mensagem_enviando", { dealId });

  let externalId: string | null = null;
  try {
    ({ externalId } = await whatsapp().sendText(channel.instanceName, row.phone, body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erro desconhecido";
    await db.update(messages).set({ status: "failed", error: msg.slice(0, 300) }).where(eq(messages.id, pending.id));
    await emit("mensagem_falhou", { dealId });
    throw new SendError(`Não foi possível enviar: ${msg}`);
  }
  return recordOutbound({ dealId, channelId: channel.id, externalId, body, userId, status: "sent", claimMessageId: pending.id });
}

/** Mensagem enviada por automação (ex.: lembrete). Usa o número do lead; falha vira alerta para a gestão. */
export async function sendAutomated(dealId: string, text: string) {
  const [row] = await db.select({ deal: deals, phone: contacts.phoneE164, name: contacts.name }).from(deals)
    .innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, dealId));
  if (!row) return;
  let channel = row.deal.channelId ? (await db.select().from(channels).where(eq(channels.id, row.deal.channelId)))[0] : undefined;
  if (!channel || channel.status !== "conectado") channel = row.deal.channelId ? undefined : (await db.select().from(channels).where(eq(channels.status, "conectado")).limit(1))[0];
  if (!channel) {
    if (env().DEV_TOOLS) return recordOutbound({ dealId, channelId: null, body: text, status: "simulado", automated: true });
    await db.insert(alerts).values({ dealId, audience: "gestao", type: "envio_automatico_falhou", severity: "info",
      message: `Não foi possível enviar a mensagem automática para ${row.name ?? row.phone}: WhatsApp desconectado.`, dedupeKey: `auto:${dealId}:${text.slice(0, 40)}` }).onConflictDoNothing();
    return;
  }
  const [pending] = await db.insert(messages).values({ dealId, contactId: row.deal.contactId, channelId: channel.id, direction: "out", kind: "text", body: text, status: "pending" }).returning({ id: messages.id });
  try {
    const { externalId } = await whatsapp().sendText(channel.instanceName, row.phone, text);
    return recordOutbound({ dealId, channelId: channel.id, externalId, body: text, status: "sent", claimMessageId: pending.id, automated: true });
  } catch (e) {
    await db.update(messages).set({ status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }).where(eq(messages.id, pending.id));
    throw e;
  }
}
