// Formatos reais da Evolution 2.3.7 (estrutura de messageRaw + envelope do webhook).
export const inboundText = (id = "3EB0A1B2C3", jid = "5571999812244@s.whatsapp.net", text = "Oi! Vi o vídeo e queria saber o valor") => ({
  event: "messages.upsert", instance: "casa-principal", date_time: "2026-10-09T13:02:11.000Z", sender: "557133330000@s.whatsapp.net",
  server_url: "http://localhost:8080", apikey: "x",
  data: {
    key: { remoteJid: jid, fromMe: false, id },
    pushName: "Mariana Couto", status: "DELIVERY_ACK",
    message: { conversation: text, messageContextInfo: {} },
    contextInfo: null, messageType: "conversation", messageTimestamp: 1791550931, instanceId: "abc", source: "android",
  },
});
export const inboundAudio = (id = "3EB0AUDIO") => ({
  event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id }, pushName: "Mariana Couto",
    message: { audioMessage: { seconds: 42, ptt: true, mimetype: "audio/ogg; codecs=opus" } }, messageType: "audioMessage", messageTimestamp: 1791550991 },
});
export const fromPhone = (id = "3EB0PHONE1") => ({
  event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: true, id }, pushName: "Você",
    message: { extendedTextMessage: { text: "Oi, Mariana! Tudo bem?" } }, messageType: "extendedTextMessage", messageTimestamp: 1791551000 },
});
export const adLead = (id = "3EB0AD") => ({
  event: "messages.upsert", instance: "casa-principal",
  data: { key: { remoteJid: "5571988887777@s.whatsapp.net", fromMe: false, id }, pushName: "Julia",
    message: { extendedTextMessage: { text: "Olá! Quero saber mais sobre isso.", contextInfo: { externalAdReply: { title: "Método Fiaes" } } } },
    messageType: "extendedTextMessage", messageTimestamp: 1791551100 },
});
export const connectionOpen = { event: "connection.update", instance: "casa-principal", data: { instance: "casa-principal", state: "open", statusReason: 200, wuid: "557133330000@s.whatsapp.net" } };
export const reaction = { event: "messages.upsert", instance: "casa-principal", data: { key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id: "R1" }, message: { reactionMessage: { text: "❤️" } } } };

/**
 * Anúncio Click-to-WhatsApp como chega da Evolution (contextInfo.externalAdReply). Valores de um anúncio da própria Casa (nenhum dado de
 * cliente); o post e o clique (`ctwaClid`) são de mentira.
 */
export const AD_REPLY = {
  ref: "", body: "Hoje quis mostrar um cabelo sem finalização.\nPorque o Método FIAES foi criado pra ser assim…", title: "CASA FIAES", ctwaClid: "AffTESTE123",
  mediaUrl: "https://www.facebook.com/casafiaes/videos/1567397237768589/", sourceId: "120232984257440453", mediaType: 2, sourceApp: "instagram",
  sourceUrl: "https://www.instagram.com/p/TESTE123/", sourceType: "ad", thumbnailUrl: "https://exemplo.invalid/miniatura.jpg", wtwaAdFormat: false,
  originalImageUrl: "https://exemplo.invalid/original.jpg", greetingMessageBody: "Oi! Como podemos ajudar?", automatedGreetingMessageShown: true,
};

/**
 * Primeira mensagem de uma conversa nova, no formato real de produção (26/10, anonimizado: número e nome de teste, sem chaves): a porta de
 * entrada vem em `data.contextInfo.entryPointConversion*`.
 */
export const entryPointInbound = (o: { id?: string; jid?: string; source?: string; app?: string; text?: string; ts?: number } = {}) => ({
  event: "messages.upsert", instance: "casa-principal", date_time: "2026-10-26T16:30:29.148Z", sender: "557133330000@s.whatsapp.net", apikey: "x",
  data: {
    key: { id: o.id ?? "ACB957EF9B01B17C", fromMe: false, remoteJid: o.jid ?? "5571900000000@s.whatsapp.net", participant: "", remoteJidAlt: o.jid ?? "5571900000000@s.whatsapp.net", addressingMode: "lid" },
    source: "android", status: "DELIVERY_ACK", pushName: "Cliente Teste",
    message: { conversation: o.text ?? "Boa tarde", messageContextInfo: { threadId: [], deviceListMetadataVersion: 2 } },
    contextInfo: { mentionedJid: [], groupMentions: [], statusAttributions: [], entryPointConversionApp: o.app ?? "whatsapp", entryPointConversionSource: o.source ?? "global_search_new_chat", entryPointConversionDelaySeconds: 173740 },
    messageType: "conversation", messageTimestamp: o.ts ?? 1793043028,
  },
});

/** Mensagem que vem do clique no anúncio: o anúncio em `data.contextInfo.externalAdReply` (ou no contextInfo do tipo, com `inMessage`). */
export const adClickInbound = (o: { id?: string; jid?: string; ad?: Record<string, unknown>; inMessage?: boolean; ts?: number; text?: string } = {}) => {
  const ad = { ...AD_REPLY, ...o.ad };
  const ctx = { externalAdReply: ad, entryPointConversionApp: "instagram", entryPointConversionSource: "ctwa_ad", entryPointConversionDelaySeconds: 3 };
  return {
    event: "messages.upsert", instance: "casa-principal", apikey: "x",
    data: {
      key: { id: o.id ?? "3EB0ADCLICK1", fromMe: false, remoteJid: o.jid ?? "5571900000001@s.whatsapp.net" }, pushName: "Cliente Anúncio", status: "DELIVERY_ACK",
      message: o.inMessage ? { extendedTextMessage: { text: o.text ?? "Olá! Quero saber mais sobre isso.", contextInfo: ctx } } : { conversation: o.text ?? "Olá! Quero saber mais sobre isso." },
      ...(o.inMessage ? {} : { contextInfo: ctx }),
      messageType: o.inMessage ? "extendedTextMessage" : "conversation", messageTimestamp: o.ts ?? 1793043100,
    },
  };
};
