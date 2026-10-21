import { it, expect, vi, afterEach } from "vitest";
import { EvolutionProvider } from "./evolution";

const calls: { url: string; body: Record<string, unknown> }[] = [];
// A busca do endereço real da mensagem (findMessages) não conta nas chamadas conferidas; sem resultado, vale o número.
const isFind = (url: string) => url.includes("/chat/findMessages/");
const noRecords = () => new Response(JSON.stringify({ messages: { records: [] } }), { status: 200 });
const mockFetch = () => vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body?: string }) => {
  if (isFind(url)) return noRecords();
  calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
  return new Response(JSON.stringify({ key: { id: "EVO1" } }), { status: 200 });
}));
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });
const p = () => new EvolutionProvider("http://evo", "k", "http://hook", "s");
const quoted = { externalId: "IN1", fromMe: false, text: "oi" };
const KEY = { id: "IN1", remoteJid: "5571999995555@s.whatsapp.net", fromMe: false };

it("sendText cita com key completa e a mensagem (a Evolution não depende do próprio banco)", async () => {
  mockFetch();
  await expect(p().sendText("rec", "+5571999995555", "Sim!", quoted)).resolves.toEqual({ externalId: "EVO1" });
  expect(calls[0].url).toBe("http://evo/message/sendText/rec");
  expect(calls[0].body).toMatchObject({ number: "5571999995555", text: "Sim!", quoted: { key: KEY, message: { conversation: "oi" } } });
});
it("sendText sem citação não manda quoted", async () => {
  mockFetch(); await p().sendText("rec", "+5571999995555", "Oi");
  expect(calls[0].body).not.toHaveProperty("quoted");
});
it("sendMedia: payload da Evolution, citação e sem caption vazio", async () => {
  mockFetch();
  await p().sendMedia("rec", "+5571999995555", { name: "f.png", mime: "image/png", data: Buffer.from("abc"), mediatype: "image" }, null, { ...quoted, fromMe: true });
  expect(calls[0].url).toBe("http://evo/message/sendMedia/rec");
  expect(calls[0].body).toMatchObject({ number: "5571999995555", mediatype: "image", mimetype: "image/png", media: "YWJj", fileName: "f.png",
    quoted: { key: { ...KEY, fromMe: true }, message: { conversation: "oi" } } });
  expect(calls[0].body).not.toHaveProperty("caption");
  await p().sendMedia("rec", "+5571999995555", { name: "f.png", mime: "image/png", data: Buffer.from("abc"), mediatype: "image" }, "Legenda");
  expect(calls[1].body).toMatchObject({ caption: "Legenda" });
});
it("sendAudio leva a citação", async () => {
  mockFetch(); await p().sendAudio("rec", "+5571999995555", Buffer.from("abc"), quoted);
  expect(calls[0].url).toBe("http://evo/message/sendWhatsAppAudio/rec");
  expect(calls[0].body).toMatchObject({ audio: "YWJj", quoted: { key: KEY, message: { conversation: "oi" } } });
});
it("markRead usa remoteJid", async () => {
  mockFetch(); await p().markRead("rec", "+5571999995555", ["A", "B"]);
  expect(calls[0].body).toEqual({ readMessages: [{ remoteJid: "5571999995555@s.whatsapp.net", fromMe: false, id: "A" }, { remoteJid: "5571999995555@s.whatsapp.net", fromMe: false, id: "B" }] });
});
it("apagar para todos (17/10): DELETE /chat/deleteMessageForEveryone com id, remoteJid e fromMe", async () => {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    if (isFind(url)) return noRecords();
    calls.push({ url, body: init.body ? JSON.parse(init.body) : {} }); methods.push(init.method ?? "");
    return new Response(JSON.stringify({ status: "PENDING" }), { status: 201 });
  }));
  await p().deleteForEveryone("rec", "+5571999995555", "OUT9");
  expect(methods[0]).toBe("DELETE");
  expect(calls[0].url).toBe("http://evo/chat/deleteMessageForEveryone/rec");
  expect(calls[0].body).toEqual({ id: "OUT9", remoteJid: "5571999995555@s.whatsapp.net", fromMe: true });
});

it("apagar para todos usa o endereço que o WhatsApp guardou (contato sem o 9; 20/10)", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body?: string }) => {
    if (isFind(url)) return new Response(JSON.stringify({ messages: { records: [{ key: { id: "OUT9", remoteJid: "557190000009@s.whatsapp.net" } }] } }), { status: 200 });
    calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
    return new Response("{}", { status: 201 });
  }));
  await p().deleteForEveryone("rec", "+5571990000009", "OUT9");
  expect(calls[0].body).toEqual({ id: "OUT9", remoteJid: "557190000009@s.whatsapp.net", fromMe: true });
});

// Task 12: corpos conferidos no código da Evolution v2.3.7 (SendReactionDto, UpdateMessageDto, SendLocationDto, SendContactDto/ContactMessage).
it("sendReaction: POST /message/sendReaction com key (remoteJid, fromMe, id) e reaction; emoji vazio tira", async () => {
  mockFetch();
  await p().sendReaction("rec", "+5571999995555", { externalId: "IN1", fromMe: false }, "👍");
  expect(calls[0].url).toBe("http://evo/message/sendReaction/rec");
  expect(calls[0].body).toEqual({ key: KEY, reaction: "👍" });
  await p().sendReaction("rec", "+5571999995555", { externalId: "OUT1", fromMe: true }, "");
  expect(calls[1].body).toEqual({ key: { id: "OUT1", remoteJid: "5571999995555@s.whatsapp.net", fromMe: true }, reaction: "" });
});
it("editText: POST /chat/updateMessage com number, key fromMe e text", async () => {
  const methods: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { method?: string; body?: string }) => {
    if (isFind(url)) return noRecords();
    calls.push({ url, body: init.body ? JSON.parse(init.body) : {} }); methods.push(init.method ?? "");
    return new Response(JSON.stringify({ key: { id: "OUT1" } }), { status: 200 });
  }));
  await p().editText("rec", "+5571999995555", "OUT1", "Novo texto");
  expect(methods[0]).toBe("POST");
  expect(calls[0].url).toBe("http://evo/chat/updateMessage/rec");
  expect(calls[0].body).toEqual({ number: "5571999995555", key: { id: "OUT1", remoteJid: "5571999995555@s.whatsapp.net", fromMe: true }, text: "Novo texto" });
});
it("sendLocation: POST /message/sendLocation com name, address, latitude e longitude", async () => {
  mockFetch();
  await expect(p().sendLocation("rec", "+5571999995555", { name: "Casa Fiaes", address: "Rua A, 10", latitude: -12.97, longitude: -38.5 })).resolves.toEqual({ externalId: "EVO1" });
  expect(calls[0].url).toBe("http://evo/message/sendLocation/rec");
  expect(calls[0].body).toMatchObject({ number: "5571999995555", name: "Casa Fiaes", address: "Rua A, 10", latitude: -12.97, longitude: -38.5 });
});
it("sendContact: POST /message/sendContact com contact [{ fullName, wuid, phoneNumber }]", async () => {
  mockFetch();
  await expect(p().sendContact("rec", "+5571999995555", { fullName: "Recepção Casa Fiaes", phoneE164: "+5571988887777" })).resolves.toEqual({ externalId: "EVO1" });
  expect(calls[0].url).toBe("http://evo/message/sendContact/rec");
  expect(calls[0].body).toMatchObject({ number: "5571999995555", contact: [{ fullName: "Recepção Casa Fiaes", wuid: "5571988887777", phoneNumber: "+5571988887777" }] });
});
