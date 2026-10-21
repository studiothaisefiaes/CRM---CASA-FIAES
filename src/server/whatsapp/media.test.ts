import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../db";
import { NextRequest } from "next/server";
import { channels, contacts, messages, users } from "../db/schema";
import { insertSession } from "../auth/sessions-store";
import { GET as getMedia } from "../../app/api/media/[id]/route";
import { GET as getAvatar } from "../../app/api/avatar/[id]/route";
import { ingestEvolution } from "./webhook";
import { setWhatsappProvider } from "./evolution";
import { downloadPendingMedia, ensureMedia, refreshAvatars } from "./media";
import { resetDb } from "../../../test/db";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
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
    setWhatsappProvider(fake({ downloadMedia: async (_i: string, node: unknown) => { asked = node; return { base64: JPEG.toString("base64"), mimetype: "image/jpeg", fileName: null }; } }));
    expect(await downloadPendingMedia()).toEqual({ tried: 1, ok: 1 });
    expect((asked as { message: { imageMessage: unknown } }).message.imageMessage).toBeTruthy();
    const [after] = await db.select().from(messages);
    expect(after.mediaMime).toBe("image/jpeg");
    expect(after.mediaPath).toMatch(/\.jpg$/);
    expect(readFileSync(path.join(DIR, after.mediaPath!)).equals(JPEG)).toBe(true);
    // já baixado: não pede de novo
    expect(await downloadPendingMedia()).toEqual({ tried: 0, ok: 0 });
  });

  it("áudio baixado entra na fila de transcrição (pendente); foto não", async () => {
    await ingestEvolution({ event: "messages.upsert", instance: "rec", data: {
      key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id: "AUD1" }, pushName: "Mariana",
      message: { audioMessage: { mimetype: "audio/ogg; codecs=opus", mediaKey: { 0: 1 }, directPath: "/v/a", seconds: 7, ptt: true } },
      messageType: "audioMessage", messageTimestamp: Math.floor(Date.now() / 1000) } });
    await ingestEvolution(photo("IMG9"));
    setWhatsappProvider(fake({ downloadMedia: async (_i: string, node: { message: Record<string, unknown> }) => node.message.audioMessage
      ? { base64: Buffer.from("OggS\0\x02opus").toString("base64"), mimetype: "audio/ogg", fileName: null }
      : { base64: JPEG.toString("base64"), mimetype: "image/jpeg", fileName: null } }));
    await downloadPendingMedia();
    const rows = await db.select().from(messages);
    expect(rows.find((m) => m.kind === "audio")!.transcriptStatus).toBe("pendente");
    expect(rows.find((m) => m.kind === "image")!.transcriptStatus).toBeNull();
  });

  describe("áudio: cópia m4a e Range (Safari)", () => {
    const M4A = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from("ftypM4A \0\0\0\0M4A isomiso2"), Buffer.alloc(100, 7)]);
    const OGG = Buffer.from("OggS\0\x02opus-original");
    const setup = async (email: string, withCopy = true) => {
      await ingestEvolution(photo("AUDR"));
      const [m] = await db.select().from(messages);
      const { writeFileSync } = await import("node:fs");
      writeFileSync(path.join(DIR, `${m.id}.ogg`), OGG);
      if (withCopy) writeFileSync(path.join(DIR, `${m.id}.m4a`), M4A);
      await db.update(messages).set({ kind: "audio", mediaPath: `${m.id}.ogg`, mediaMime: "audio/ogg", playbackPath: withCopy ? `${m.id}.m4a` : null });
      return { id: m.id, cookie: await session(email) };
    };
    const get = (id: string, cookie: string, qs = "", headers: Record<string, string> = {}) =>
      getMedia(new NextRequest(`http://localhost/api/media/${id}${qs}`, { headers: { cookie, ...headers } }), { params: Promise.resolve({ id }) });

    it("serve o m4a (audio/mp4) quando existe, com Accept-Ranges", async () => {
      const { id, cookie } = await setup("aud1@t.local");
      const res = await get(id, cookie);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/mp4");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect(Buffer.from(await res.arrayBuffer()).equals(M4A)).toBe(true);
    });

    it("Range devolve 206 com o pedaço pedido", async () => {
      const { id, cookie } = await setup("aud2@t.local");
      const res = await get(id, cookie, "", { range: "bytes=0-1" });
      expect(res.status).toBe(206);
      expect(res.headers.get("content-range")).toBe(`bytes 0-1/${M4A.length}`);
      expect(res.headers.get("content-length")).toBe("2");
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([0, 0]);
      const tail = await get(id, cookie, "", { range: "bytes=10-" });
      expect(tail.headers.get("content-range")).toBe(`bytes 10-${M4A.length - 1}/${M4A.length}`);
      const bad = await get(id, cookie, "", { range: `bytes=${M4A.length + 5}-` });
      expect(bad.status).toBe(416);
      expect(bad.headers.get("content-range")).toBe(`bytes */${M4A.length}`);
    });

    it("?original=1 e áudio sem cópia servem o ogg", async () => {
      const a = await setup("aud3@t.local");
      const orig = await get(a.id, a.cookie, "?original=1");
      expect(orig.headers.get("content-type")).toBe("audio/ogg");
      expect(Buffer.from(await orig.arrayBuffer()).equals(OGG)).toBe(true);
    });

    it("cópia registrada mas sumida do disco: cai no original", async () => {
      const { id, cookie } = await setup("aud4@t.local", false);
      await db.update(messages).set({ playbackPath: `${id}.m4a` });
      const res = await get(id, cookie);
      expect(res.headers.get("content-type")).toBe("audio/ogg");
    });

    it("ETag: a mesma mídia devolve 304 sem corpo (com cache longo); Range continua 206", async () => {
      const { id, cookie } = await setup("aud6@t.local");
      const first = await get(id, cookie);
      const etag = first.headers.get("etag")!;
      expect(etag).toMatch(/^W\/"/);
      expect(first.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
      const again = await get(id, cookie, "", { "if-none-match": etag });
      expect(again.status).toBe(304);
      expect(await again.text()).toBe("");
      expect((await get(id, cookie, "", { "if-none-match": etag, range: "bytes=0-1" })).status).toBe(206);
    });

    it("sem login continua 401", async () => {
      const { id } = await setup("aud5@t.local");
      expect((await get(id, "")).status).toBe(401);
    });
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

  it("mimetype declarado image/jpeg com conteúdo <svg> é gravado como binário e servido só como download", async () => {
    await ingestEvolution(photo("IMG4"));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>';
    setWhatsappProvider(fake({ downloadMedia: async () => ({ base64: Buffer.from(svg).toString("base64"), mimetype: "image/jpeg", fileName: null }) }));
    expect(await downloadPendingMedia()).toEqual({ tried: 1, ok: 1 });
    const [m] = await db.select().from(messages);
    expect(m.mediaMime).toBe("application/octet-stream");
    expect(m.mediaPath).toMatch(/\.bin$/);

    const [u] = await db.insert(users).values({ name: "Ana", email: "ana@t.local", role: "atendente", passwordHash: "x" }).returning();
    const { token } = await insertSession(u.id);
    const req = new NextRequest(`http://localhost/api/media/${m.id}`, { headers: { cookie: `cf_session=${token}` } });
    const res = await getMedia(req, { params: Promise.resolve({ id: m.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("arquivo legado gravado com o mimetype declarado é reavaliado pelos bytes ao servir", async () => {
    await ingestEvolution(photo("IMG5"));
    const [m] = await db.select().from(messages);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(DIR, "legado.jpg"), "<html><script>alert(1)</script>");
    await db.update(messages).set({ mediaPath: "legado.jpg", mediaMime: "image/jpeg" });
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana2@t.local", role: "atendente", passwordHash: "x" }).returning();
    const { token } = await insertSession(u.id);
    const res = await getMedia(new NextRequest(`http://localhost/api/media/${m.id}`, { headers: { cookie: `cf_session=${token}` } }), { params: Promise.resolve({ id: m.id }) });
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("mídia expirada pela retenção responde 410 e não baixa de novo", async () => {
    await ingestEvolution(photo("IMG6"));
    let calls = 0;
    setWhatsappProvider(fake({ downloadMedia: async () => { calls++; return { base64: JPEG.toString("base64"), mimetype: "image/jpeg", fileName: null }; } }));
    const [m] = await db.select().from(messages);
    await db.update(messages).set({ mediaPurgedAt: new Date() });
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana410@t.local", role: "atendente", passwordHash: "x" }).returning();
    const { token } = await insertSession(u.id);
    const res = await getMedia(new NextRequest(`http://localhost/api/media/${m.id}`, { headers: { cookie: `cf_session=${token}` } }), { params: Promise.resolve({ id: m.id }) });
    expect(res.status).toBe(410);
    expect(await downloadPendingMedia()).toEqual({ tried: 0, ok: 0 });
    expect(calls).toBe(0);
  });

  const session = async (email: string) => {
    const [u] = await db.insert(users).values({ name: "Ana", email, role: "atendente", passwordHash: "x" }).returning();
    return `cf_session=${(await insertSession(u.id)).token}`;
  };
  const doc = (id: string, documentMessage: Record<string, unknown>, wrapped: boolean) => ({ event: "messages.upsert", instance: "rec", data: {
    key: { remoteJid: "5571999812244@s.whatsapp.net", fromMe: false, id }, pushName: "Mariana",
    message: wrapped ? { documentWithCaptionMessage: { message: { documentMessage } } } : { documentMessage },
    messageType: wrapped ? "documentWithCaptionMessage" : "documentMessage", messageTimestamp: Math.floor(Date.now() / 1000) } });
  const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj");
  const servePdf = async (payload: ReturnType<typeof doc>, email: string) => {
    await ingestEvolution(payload);
    setWhatsappProvider(fake({ downloadMedia: async () => ({ base64: PDF.toString("base64"), mimetype: "application/pdf", fileName: null }) }));
    const [m] = await db.select().from(messages);
    const res = await getMedia(new NextRequest(`http://localhost/api/media/${m.id}`, { headers: { cookie: await session(email) } }), { params: Promise.resolve({ id: m.id }) });
    expect(res.headers.get("content-type")).toBe("application/pdf");
    return res.headers.get("content-disposition");
  };

  it("PDF com legenda baixa com o nome original do arquivo", async () => {
    const cd = await servePdf(doc("DOC1", { caption: "segue o orçamento", fileName: "orcamento-maio.pdf", mimetype: "application/pdf" }, true), "d1@t.local");
    expect(cd).toBe('attachment; filename="orcamento-maio.pdf"');
  });

  it("PDF com legenda e sem nome de arquivo ganha a extensão .pdf", async () => {
    const cd = await servePdf(doc("DOC2", { caption: "segue o orcamento", mimetype: "application/pdf" }, false), "d2@t.local");
    expect(cd).toBe('attachment; filename="segue o orcamento.pdf"');
  });

  it("avatar com conteúdo <svg> sai como download binário", async () => {
    await ingestEvolution(photo("IMG6"));
    const [c] = await db.select().from(contacts);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(DIR, `avatar-${c.id}.jpg`), '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    await db.update(contacts).set({ avatarPath: `avatar-${c.id}.jpg` });
    const res = await getAvatar(new NextRequest(`http://localhost/api/avatar/${c.id}`, { headers: { cookie: await session("av@t.local") } }), { params: Promise.resolve({ id: c.id }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it("avatar JPEG real abre inline como imagem", async () => {
    await ingestEvolution(photo("IMG7"));
    const [c] = await db.select().from(contacts);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(path.join(DIR, `avatar-${c.id}.jpg`), JPEG);
    await db.update(contacts).set({ avatarPath: `avatar-${c.id}.jpg` });
    const res = await getAvatar(new NextRequest(`http://localhost/api/avatar/${c.id}`, { headers: { cookie: await session("av2@t.local") } }), { params: Promise.resolve({ id: c.id }) });
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("content-disposition")).toMatch(/^inline/);
    expect(res.headers.get("cache-control")).toBe("private, max-age=86400");
  });
});
