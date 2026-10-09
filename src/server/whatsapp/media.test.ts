import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../db";
import { channels, contacts, messages } from "../db/schema";
import { ingestEvolution } from "./webhook";
import { setWhatsappProvider } from "./evolution";
import { downloadPendingMedia, ensureMedia, refreshAvatars } from "./media";
import { resetDb } from "../../../test/db";

const DIR = mkdtempSync(path.join(tmpdir(), "cf-media-"));
process.env.MEDIA_DIR = DIR;

const fake = (over: Record<string, unknown> = {}) => ({
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const,
  logout: async () => {}, remove: async () => {}, sendText: async () => ({ externalId: null }), ...over,
});
const photo = (id: string) => ({ event: "messages.upsert", instance: "rec", data: {
  key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id }, pushName: "Mariana",
  message: { imageMessage: { caption: "assim tá meu cabelo", mimetype: "image/jpeg", mediaKey: { 0: 1 }, directPath: "/v/x", jpegThumbnail: "AAAA" } },
  messageType: "imageMessage", messageTimestamp: Math.floor(Date.now() / 1000) } });

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec", status: "conectado", phone: "+557199990404" });
});
afterEach(() => setWhatsappProvider(null));

describe("mídia do WhatsApp", () => {
  it("foto recebida guarda o nó da mídia e o worker baixa o arquivo", async () => {
    await ingestEvolution(photo("IMG1"));
    const [m] = await db.select().from(messages);
    expect(m.kind).toBe("image");
    expect(m.body).toBe("assim tá meu cabelo");
    expect(m.media?.key.id).toBe("IMG1");

    let asked: unknown = null;
    setWhatsappProvider(fake({ downloadMedia: async (_i: string, node: unknown) => { asked = node; return { base64: Buffer.from("JPEGDATA").toString("base64"), mimetype: "image/jpeg", fileName: null }; } }));
    expect(await downloadPendingMedia()).toEqual({ tried: 1, ok: 1 });
    expect((asked as { message: { imageMessage: unknown } }).message.imageMessage).toBeTruthy();
    const [after] = await db.select().from(messages);
    expect(after.mediaMime).toBe("image/jpeg");
    expect(readFileSync(path.join(DIR, after.mediaPath!)).toString()).toBe("JPEGDATA");
    // já baixado: não pede de novo
    expect(await downloadPendingMedia()).toEqual({ tried: 0, ok: 0 });
  });

  it("falha no download tenta no máximo 3 vezes", async () => {
    await ingestEvolution(photo("IMG2"));
    setWhatsappProvider(fake({ downloadMedia: async () => { throw new Error("404 media"); } }));
    for (let i = 0; i < 5; i++) await downloadPendingMedia();
    const [m] = await db.select().from(messages);
    expect(m.mediaAttempts).toBe(3);
    expect(await ensureMedia("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("foto de perfil de quem tem lead aberto é baixada uma vez", async () => {
    await ingestEvolution(photo("IMG3"));
    const server = await import("node:http").then((h) => h.createServer((_q, r) => { r.writeHead(200, { "content-type": "image/jpeg" }); r.end("FOTO"); }));
    await new Promise<void>((ok) => server.listen(0, ok));
    const port = (server.address() as { port: number }).port;
    setWhatsappProvider(fake({ profilePictureUrl: async () => `http://127.0.0.1:${port}/p.jpg` }));
    expect(await refreshAvatars()).toEqual({ tried: 1, ok: 1 });
    expect(await refreshAvatars()).toEqual({ tried: 0, ok: 0 });
    server.close();
    const [c] = await db.select().from(contacts);
    expect(existsSync(path.join(DIR, c.avatarPath!))).toBe(true);
  });
});
