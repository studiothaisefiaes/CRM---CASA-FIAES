import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, channels, contacts, deals, messages } from "../db/schema";
import { isHiddenNumber } from "@/lib/phone-client";
import { parseSignature, signBody } from "@/lib/signature";
import { whatsapp } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";
import { UserFacingError } from "./errors";
import { assertFuncaoLigada, funcaoParam, funcaoTexto } from "./funcoes";
import { getCasaInfo } from "./client-link/settings";
import { normalizePhone } from "./phone";
import { resolveChannel, sendToolFromCrm } from "./send";
import { emit } from "./events";

/** Prazo padrão para editar (o número vale em Configurações › Recursos › Editar mensagem enviada, `janela_min`). */
export const EDIT_WINDOW_MS = 15 * 60_000;
export const REACTION_EMOJIS = ["👍", "❤️", "🙏", "😂"] as const;

/** Mensagem + número da cliente + o WhatsApp por onde falar dela (o da própria mensagem; sem ele, o da conversa). */
async function loadMessage(messageId: string) {
  const [m] = await db.select({ msg: messages, phone: contacts.phoneE164 }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId)).where(eq(messages.id, messageId));
  if (!m) throw new UserFacingError("Mensagem não encontrada.");
  if (isHiddenNumber(m.phone)) throw new UserFacingError("Essa cliente está com o número oculto no WhatsApp. Faça isso pelo celular do salão.");
  let channel = m.msg.channelId ? (await db.select().from(channels).where(eq(channels.id, m.msg.channelId)))[0] ?? null : null;
  if (!channel || channel.status !== "conectado") {
    const [deal] = m.msg.dealId ? await db.select().from(deals).where(eq(deals.id, m.msg.dealId)) : [];
    channel = deal ? await resolveChannel(deal.id, deal) : null;
  }
  return { msg: m.msg, phone: m.phone, channel };
}

const providerFailure = (e: unknown, what: string): never => {
  if (!(e instanceof ProviderError)) throw e;
  throw new UserFacingError(e.status ? `Não deu para ${what}: o WhatsApp recusou.` : `Não deu para ${what}: o WhatsApp não respondeu. Tente de novo em instantes.`);
};

/** Reação da Casa (👍 ❤️ 🙏 😂). `null` ou o mesmo emoji de antes tira a reação. Só grava depois de o WhatsApp aceitar. */
export async function reactToMessage(messageId: string, emoji: string | null, userId: string): Promise<void> {
  await assertFuncaoLigada("reagir");
  if (emoji !== null && !(REACTION_EMOJIS as readonly string[]).includes(emoji)) throw new UserFacingError("Escolha 👍, ❤️, 🙏 ou 😂.");
  const { msg, phone, channel } = await loadMessage(messageId);
  if (msg.deletedAt) throw new UserFacingError("Essa mensagem foi apagada.");
  if (!msg.externalId || msg.status === "pending" || msg.status === "failed") throw new UserFacingError("Essa mensagem não chegou ao WhatsApp: não dá para reagir.");
  const next = emoji && msg.reactions?.casa !== emoji ? emoji : null;
  if (channel) {
    const p = whatsapp();
    if (!p.sendReaction) throw new UserFacingError("Este WhatsApp ainda não reage a mensagens pelo CRM.");
    try { await p.sendReaction(channel.instanceName, phone, { externalId: msg.externalId, fromMe: msg.direction === "out" }, next ?? ""); }
    catch (e) { providerFailure(e, "reagir"); }
  }
  const { casa: _old, ...rest } = msg.reactions ?? {};
  const reactions = next ? { ...rest, casa: next } : Object.keys(rest).length ? rest : null;
  await db.update(messages).set({ reactions }).where(eq(messages.id, msg.id));
  await db.insert(auditLog).values({ userId, action: next ? "reagiu" : "tirou_reacao", entity: "message", entityId: msg.id, data: { emoji: next ?? emoji } });
  if (msg.dealId) await emit("mensagem_atualizada", { dealId: msg.dealId });
}

/**
 * Edita o texto de uma mensagem que ESTA pessoa enviou pelo CRM (enviada, texto) dentro do prazo (`janela_min`).
 * A assinatura da pessoa continua na primeira linha. O texto antigo vai para a auditoria; a conversa mostra "Editada".
 */
export async function editSentMessage(messageId: string, text: string, userId: string, now = new Date()): Promise<void> {
  await assertFuncaoLigada("editar_mensagem");
  const typed = text.trim();
  if (!typed) throw new UserFacingError("Escreva o texto da mensagem.");
  if (typed.length > 4000) throw new UserFacingError("Mensagem muito longa (máximo 4.000 caracteres).");
  const { msg, phone, channel } = await loadMessage(messageId);
  if (msg.direction !== "out" || msg.sentVia !== "crm" || !msg.sentByUserId || msg.kind !== "text" || msg.deletedAt || msg.importedAt)
    throw new UserFacingError("Só dá para editar mensagens que a Casa enviou pelo CRM.");
  if (msg.sentByUserId !== userId) throw new UserFacingError("Só dá para editar as mensagens que você mesma enviou.");
  if (!["sent", "delivered", "read"].includes(msg.status) || !msg.externalId) throw new UserFacingError("Essa mensagem não chegou ao WhatsApp: não dá para editar.");
  const janela = await funcaoParam("editar_mensagem", "janela_min");
  if (now.getTime() - msg.createdAt.getTime() > janela * 60_000) throw new UserFacingError(`Só dá para editar até ${janela} minutos depois de enviar.`);
  const sig = parseSignature(msg.body);
  const body = sig ? signBody(sig, typed) : typed;
  if (channel) {
    const p = whatsapp();
    if (!p.editText) throw new UserFacingError("Este WhatsApp ainda não edita mensagens pelo CRM.");
    try { await p.editText(channel.instanceName, phone, msg.externalId, body); }
    catch (e) { providerFailure(e, "editar"); }
  }
  await db.update(messages).set({ body, editedAt: now }).where(eq(messages.id, msg.id));
  await db.insert(auditLog).values({ userId, action: "editou_mensagem", entity: "message", entityId: msg.id, data: { dealId: msg.dealId, antes: msg.body, depois: body }, createdAt: now });
  if (msg.dealId) await emit("mensagem_atualizada", { dealId: msg.dealId });
}

/** Mesmo texto que o eco do WhatsApp gera para localização (parseContent), para o eco casar com a linha. */
const locationBody = (name: string, address: string, lat: number, lng: number) => [[name, address].filter(Boolean).join(" · "), `https://maps.google.com/?q=${lat},${lng}`].filter(Boolean).join(" · ");

/** "Como chegar": manda o pino da Casa (Página da cliente) com o nome e o endereço. */
export async function sendCasaLocation(dealId: string, userId: string): Promise<void> {
  await assertFuncaoLigada("como_chegar");
  const casa = await getCasaInfo();
  if (casa.latitude === null || casa.longitude === null) throw new UserFacingError("Cadastre o pino da Casa em Página da cliente.");
  const loc = { name: await funcaoTexto("como_chegar", "nome_pino"), address: casa.endereco ?? "", latitude: casa.latitude, longitude: casa.longitude };
  await sendToolFromCrm(dealId, userId, {
    kind: "location", need: "sendLocation", label: "localização", body: locationBody(loc.name, loc.address, loc.latitude, loc.longitude),
    send: (p, instance, phone) => p.sendLocation!(instance, phone, loc),
  });
}

/** "Mandar contato": cartão com nome e telefone. */
export async function sendContactCard(dealId: string, c: { fullName: string; phoneE164: string }, userId: string): Promise<void> {
  await assertFuncaoLigada("mandar_contato");
  const fullName = c.fullName.trim();
  if (!fullName) throw new UserFacingError("Escreva o nome do contato.");
  if (fullName.length > 100) throw new UserFacingError("Nome muito longo (máximo 100 caracteres).");
  const phone = normalizePhone(c.phoneE164);
  if (!phone) throw new UserFacingError("Telefone inválido. Use DDD + número.");
  await sendToolFromCrm(dealId, userId, {
    kind: "contact", need: "sendContact", label: "contato", body: `${fullName} · ${phone}`,
    send: (p, instance, to) => p.sendContact!(instance, to, { fullName, phoneE164: phone }),
  });
}
