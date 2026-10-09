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
