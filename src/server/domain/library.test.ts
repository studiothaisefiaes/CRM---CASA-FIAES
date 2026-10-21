import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { channels, libraryFiles, messages, outbox, users } from "../db/schema";
import { recordInbound } from "./deals";
import { drainOutbox, enqueueAutomated } from "./outbox";
import { deleteLibraryFile, listLibrary, readLibraryFile, sendLibraryFile, updateLibraryFile, uploadLibraryFile } from "./library";
import { saveFuncao } from "./funcoes";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { mediaDir } from "../whatsapp/media";
import { purgeExpiredMedia } from "../whatsapp/retention";
import { ProviderError } from "../whatsapp/provider";
import { resetDb } from "../../../test/db";

const OPEN_TIME = new Date("2026-10-13T13:00:00Z"); // ter 10h em Salvador (aberto)
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const PDF = Buffer.from("%PDF-1.7 tabela");
const OGG = Buffer.from("OggS\0\0\0\0");

const fake = { media: [] as { mediatype: string; caption: string | null }[], audio: 0, fail: null as Error | null };
const provider = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async () => ({ externalId: "T1" }),
  sendMedia: async (_i: string, _to: string, f: { mediatype: string }, caption: string | null) => {
    if (fake.fail) { const e = fake.fail; fake.fail = null; throw e; }
    fake.media.push({ mediatype: f.mediatype, caption }); return { externalId: "M" + fake.media.length }; },
  sendAudio: async () => { fake.audio++; return { externalId: "A1" }; },
};
let uid = "", dealId = "";
const lastOut = async (id: string) => (await db.select().from(messages).where(and(eq(messages.dealId, id), eq(messages.direction, "out"))).orderBy(desc(messages.createdAt)))[0];
const photo = (tags: string[] = [], caption: string | null = "Tabela de preços") => uploadLibraryFile({ name: "tabela.png", mime: "image/png", data: PNG }, { name: "Tabela", caption, tags }, uid);

beforeEach(async () => {
  fake.media.length = 0; fake.audio = 0; fake.fail = null; await resetDb(); setWhatsappProvider(provider);
  [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999995555", body: "oi", at: OPEN_TIME, now: OPEN_TIME });
  if (!("dealId" in r)) throw new Error(); dealId = r.dealId;
});
afterEach(() => setWhatsappProvider(null));

describe("Biblioteca: subir e listar", () => {
  it("sobe uma foto com etiqueta Preços e lista por etiqueta", async () => {
    const { id } = await photo(["Preços"]);
    await photo(["Cuidados"]);
    const list = await listLibrary({ tag: "Preços" });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, kind: "image", tags: ["Preços"], thumbUrl: `/api/biblioteca/${id}?thumb=1` });
    expect(await listLibrary()).toHaveLength(2);
    expect(await listLibrary({ q: "tabela" })).toHaveLength(2);
    expect(existsSync(path.join(mediaDir(), "biblioteca", `${id}.png`))).toBe(true);
  });
  it("arquivo que não é foto, vídeo mp4, PDF ou áudio é recusado com o motivo", async () => {
    await expect(uploadLibraryFile({ name: "x.exe", mime: "application/octet-stream", data: Buffer.from("MZ") }, { name: "x", tags: [] }, uid))
      .rejects.toThrow("Esse tipo de arquivo não pode ir pelo WhatsApp. Use foto, vídeo MP4, PDF ou áudio.");
  });
  it("o limite de tamanho vem da função (padrão 16 MB) e muda quando a gestão muda", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024)]);
    await uploadLibraryFile({ name: "g.png", mime: "image/png", data: big }, { name: "Grande", tags: [] }, uid); // 2 MB cabe em 16
    await saveFuncao("biblioteca", { params: { tamanho_max_mb: 1 } }, uid);
    await expect(uploadLibraryFile({ name: "g.png", mime: "image/png", data: big }, { name: "Grande 2", tags: [] }, uid)).rejects.toThrow("O arquivo passa de 1 MB. Escolha um menor.");
  });
  it("função desligada: subir, editar e enviar são recusados", async () => {
    const { id } = await photo();
    await saveFuncao("biblioteca", { on: false }, uid);
    await expect(photo()).rejects.toThrow("Biblioteca está desligada em Configurações › Recursos.");
    await expect(updateLibraryFile(id, { name: "N", tags: [] }, uid)).rejects.toThrow("desligada");
    await expect(sendLibraryFile(dealId, id, null, uid)).rejects.toThrow("desligada");
    expect(fake.media).toHaveLength(0);
  });
  it("editar muda nome, legenda e etiquetas", async () => {
    const { id } = await photo(["Preços"]);
    await updateLibraryFile(id, { name: "Tabela 2026", caption: "Nova", tags: ["Resultados", " Resultados ", "Promoção"] }, uid);
    expect((await listLibrary())[0]).toMatchObject({ name: "Tabela 2026", caption: "Nova", tags: ["Resultados", "Promoção"] });
  });
});

describe("Biblioteca: envio", () => {
  it("a atendente envia em um toque: legenda da Biblioteca, mesmo caminho do envio de arquivo", async () => {
    const { id } = await photo();
    await sendLibraryFile(dealId, id, null, uid);
    expect(fake.media).toEqual([{ mediatype: "image", caption: "Tabela de preços" }]);
    expect(await lastOut(dealId)).toMatchObject({ kind: "image", status: "sent", sentByUserId: uid });
    await sendLibraryFile(dealId, id, "Para você 💛", uid);
    expect(fake.media[1].caption).toBe("Para você 💛");
  });
  it("a fila envia um arquivo da Biblioteca como mídia e ele aparece na conversa", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela de preços" });
    const r = await drainOutbox(OPEN_TIME);
    expect(r.sent).toBe(1);
    expect(fake.media).toEqual([{ mediatype: "image", caption: "Tabela de preços" }]);
    expect(await lastOut(dealId)).toMatchObject({ kind: "image", status: "sent", sentByUserId: null, mediaPath: `biblioteca/${fileId}.png`, mediaMime: "image/png", body: "Tabela de preços" });
  });
  it("PDF sem legenda sai com o nome do arquivo; áudio sai como voz, sem legenda", async () => {
    const { id: pdf } = await uploadLibraryFile({ name: "t.pdf", mime: "application/pdf", data: PDF }, { name: "Tabela completa", tags: [] }, uid);
    const { id: aud } = await uploadLibraryFile({ name: "v.ogg", mime: "audio/ogg", data: OGG }, { name: "Como chegar", tags: [] }, uid);
    await enqueueAutomated({ dealId, kind: "media", fileId: pdf, text: "" });
    await enqueueAutomated({ dealId, kind: "media", fileId: aud, text: "" });
    expect(await drainOutbox(OPEN_TIME)).toMatchObject({ sent: 2 });
    expect(fake.media).toEqual([{ mediatype: "document", caption: null }]);
    expect(fake.audio).toBe(1);
    const out = await db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out")));
    expect(out.map((m) => [m.kind, m.body]).sort()).toEqual([["audio", null], ["document", "Tabela completa.pdf"]]);
  });
  it("arquivo apagado da Biblioteca depois de enfileirar: o item é cancelado com o motivo", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    await deleteLibraryFile(fileId, uid);
    expect(await drainOutbox(OPEN_TIME)).toMatchObject({ sent: 0, cancelled: 1 });
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "cancelled", error: "O arquivo saiu da Biblioteca." });
    expect(fake.media).toHaveLength(0);
  });
  it("enfileirar arquivo que não existe ou sem fileId é recusado", async () => {
    await expect(enqueueAutomated({ dealId, kind: "media", text: "x" })).rejects.toThrow("Falta o arquivo");
    await expect(enqueueAutomated({ dealId, kind: "media", fileId: "00000000-0000-4000-8000-000000000000", text: "x" })).rejects.toThrow("saiu da Biblioteca");
  });
  it("função desligada depois de enfileirar não cancela: o item segue as regras da fila", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    await saveFuncao("biblioteca", { on: false }, uid);
    expect(await drainOutbox(OPEN_TIME)).toMatchObject({ sent: 1 });
  });
  it("a pausa das automáticas vale para o arquivo da fila (já checada no processItem)", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    await db.execute(sql`update contacts set automations_paused_until = 'infinity'`);
    expect(await drainOutbox(OPEN_TIME)).toMatchObject({ sent: 0, cancelled: 1 });
  });
});

describe("Biblioteca: legenda e envio em dobro", () => {
  it("sem legenda ao enfileirar, renomear depois não faz o nome sair como legenda", async () => {
    const { id: fileId } = await photo([], null);
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "" });
    await updateLibraryFile(fileId, { name: "Outro nome", caption: null, tags: [] }, uid);
    await drainOutbox(OPEN_TIME);
    expect(fake.media).toEqual([{ mediatype: "image", caption: null }]);
  });
  it("legenda igual ao nome de propósito sai como legenda", async () => {
    const { id: fileId } = await photo([], null); // nome "Tabela"
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    await drainOutbox(OPEN_TIME);
    expect(fake.media).toEqual([{ mediatype: "image", caption: "Tabela" }]);
  });
  it("erro de \"não enviado\" na 1ª vez: o 2º envio sai e há exatamente uma mensagem na conversa", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    fake.fail = new ProviderError("Evolution respondeu 500: fora do ar", 500);
    expect(await drainOutbox(OPEN_TIME)).toMatchObject({ retry: 1, sent: 0 });
    expect(fake.media).toHaveLength(0);
    expect(await drainOutbox(new Date(OPEN_TIME.getTime() + 6 * 60_000))).toMatchObject({ sent: 1 });
    expect(fake.media).toHaveLength(1);
    expect((await db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out"))))).toHaveLength(1);
  });
  it("sem resposta HTTP (incerto): não reenvia", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    fake.fail = new ProviderError("timeout");
    expect(await drainOutbox(OPEN_TIME)).toMatchObject({ failed: 1, sent: 0 });
    expect(await drainOutbox(new Date(OPEN_TIME.getTime() + 60 * 60_000))).toMatchObject({ sent: 0 });
    expect(fake.media).toHaveLength(0);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "failed" });
  });
});

describe("Biblioteca: apagar e retenção", () => {
  it("apagar é lógico: a conversa que já recebeu continua mostrando o arquivo", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    await drainOutbox(OPEN_TIME);
    await deleteLibraryFile(fileId, uid);
    const [row] = await db.select().from(libraryFiles).where(eq(libraryFiles.id, fileId));
    expect(row.deletedAt).not.toBeNull();
    expect(row.path).toBe(`biblioteca/${fileId}.png`);
    expect(existsSync(path.join(mediaDir(), row.path))).toBe(true);
    expect(await listLibrary()).toHaveLength(0);
    expect(await readLibraryFile(fileId)).toBeNull();
    expect((await lastOut(dealId)).mediaPath).toBe(row.path);
    await expect(deleteLibraryFile(fileId, uid)).rejects.toThrow("não está mais na Biblioteca");
  });
  it("a retenção de mídia nunca apaga o arquivo da Biblioteca nem marca a mensagem como expirada", async () => {
    const { id: fileId } = await photo();
    await enqueueAutomated({ dealId, kind: "media", fileId, text: "Tabela" });
    await drainOutbox(OPEN_TIME);
    const r = await purgeExpiredMedia(new Date("2030-01-01T00:00:00Z"), 1);
    expect(r.purged).toBe(0);
    expect(existsSync(path.join(mediaDir(), "biblioteca", `${fileId}.png`))).toBe(true);
    expect(await lastOut(dealId)).toMatchObject({ mediaPurgedAt: null, mediaPath: `biblioteca/${fileId}.png` });
    expect(await readLibraryFile(fileId)).not.toBeNull();
  });
});
