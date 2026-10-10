import { it, expect, vi, afterEach } from "vitest";
import { EvolutionProvider } from "./evolution";

const calls: { url: string; body: Record<string, unknown> }[] = [];
const mockFetch = () => vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body?: string }) => {
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
