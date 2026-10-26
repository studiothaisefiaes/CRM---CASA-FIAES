import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, lists, messages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { attachToQuickReply, detachFromQuickReply, quickReplyAttachment, quickReplyIaQuando, sendQuickReply, setQuickReplyFolder, setQuickReplyIaQuando } from "./quick-replies";
import { mediaDir } from "../whatsapp/media";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";
import { setVideoCompressor } from "../whatsapp/video";

const PDF = Buffer.from("%PDF-1.7 tabela de precos");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
const mp4 = (size: number) => Buffer.concat([Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isom"), Buffer.alloc(Math.max(0, size - 20))]);
const MP4 = mp4(84);
const calls: string[] = []; const captions: (string | null)[] = []; let failText = false; let failMedia = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string) => { if (failText) throw new ProviderError("texto recusado", 500); calls.push(`text:${text}`); return { externalId: `T${calls.length}` }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string; name: string }, caption: string | null) => { if (failMedia) throw new ProviderError("arquivo recusado", 500); calls.push(`media:${f.mime}:${f.name}`); captions.push(caption); return { externalId: `M${calls.length}` }; },
  sendAudio: async () => { calls.push("audio"); return { externalId: "A1" }; },
};
let uid = "", dealId = "", replyId = "";
beforeEach(async () => {
  calls.length = 0; captions.length = 0; failText = false; failMedia = false;
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999990041", pushName: "Cliente Teste", body: "Quanto custa?" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  [{ id: replyId }] = await db.insert(lists).values({ kind: "quick_reply", label: "tabela-teste-l5", body: "Segue a nossa tabela 😊" }).returning();
  setWhatsappProvider(fake);
  // O ffmpeg de verdade não roda aqui: o "comprimido" sai maior, então fica o original (cada teste de compressão troca isto).
  setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(1024 * 1024)); });
});
afterEach(() => { setWhatsappProvider(null); setVideoCompressor(null); });
const row = async () => (await db.select().from(lists).where(eq(lists.id, replyId)))[0];

describe("respostas prontas: pasta e anexo", () => {
  it("pasta: grava sem espaços sobrando, limpa e recusa nome longo", async () => {
    await setQuickReplyFolder(replyId, "  Preços  ", uid);
    expect((await row()).category).toBe("Preços");
    await setQuickReplyFolder(replyId, "", uid);
    expect((await row()).category).toBeNull();
    await expect(setQuickReplyFolder(replyId, "x".repeat(41), uid)).rejects.toThrow(/máximo 40/);
  });

  it("anexo: guarda o PDF; trocar apaga o anterior; tirar apaga arquivo e registro", async () => {
    const a = await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    expect(a).toMatchObject({ name: "tabela.pdf", mime: "application/pdf", kind: "document" });
    expect(existsSync(path.join(mediaDir(), a.path))).toBe(true);
    const b = await attachToQuickReply(replyId, { name: "tabela-nova.pdf", mime: "application/pdf", data: PDF }, uid);
    expect(existsSync(path.join(mediaDir(), a.path))).toBe(false);
    expect(quickReplyAttachment((await row()).meta)?.name).toBe("tabela-nova.pdf");
    await detachFromQuickReply(replyId, uid);
    expect(quickReplyAttachment((await row()).meta)).toBeNull();
    expect(existsSync(path.join(mediaDir(), b.path))).toBe(false);
  });

  it("recusa arquivo disfarçado (o tipo vem dos bytes)", async () => {
    await expect(attachToQuickReply(replyId, { name: "x.pdf", mime: "application/pdf", data: Buffer.from("<html>") }, uid)).rejects.toThrow(/tipo de arquivo/);
  });

  it("envia o texto e depois o arquivo; com texto vazio, só o arquivo", async () => {
    await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    await sendQuickReply(dealId, replyId, "Segue a nossa tabela 😊", uid);
    expect(calls).toEqual([expect.stringMatching(/^text:[\s\S]*Segue a nossa tabela/), "media:application/pdf:tabela.pdf"]);
    calls.length = 0;
    await sendQuickReply(dealId, replyId, "  ", uid);
    expect(calls).toEqual(["media:application/pdf:tabela.pdf"]);
  });

  it("texto não saiu: o arquivo não vai; arquivo falhou depois do texto: avisa que só o texto saiu", async () => {
    await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    failText = true;
    await expect(sendQuickReply(dealId, replyId, "Segue", uid)).rejects.toThrow(/texto recusado/);
    expect(calls).toEqual([]);
    failText = false; failMedia = true;
    await expect(sendQuickReply(dealId, replyId, "Segue", uid)).rejects.toThrow("O texto saiu, mas o arquivo não: arquivo recusado. Anexe e envie de novo.");
    expect(calls).toHaveLength(1);
  });

  it("anexo que sumiu do disco: erro claro e nada sai", async () => {
    const a = await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    await unlink(path.join(mediaDir(), a.path));
    await expect(sendQuickReply(dealId, replyId, "Segue", uid)).rejects.toThrow(/não está mais disponível/);
    expect(calls).toEqual([]);
  });
});

const outMedia = async () => (await db.select().from(messages)).filter((m) => m.direction === "out" && m.kind !== "text");

describe("respostas prontas: foto e vídeo com o texto como legenda (pedido do dono, 24/10)", () => {
  it("foto com texto: UMA mensagem, a foto com o texto assinado como legenda (embaixo)", async () => {
    await attachToQuickReply(replyId, { name: "resultado.png", mime: "image/png", data: PNG }, uid);
    await sendQuickReply(dealId, replyId, "Olha o resultado 💛", uid);
    expect(calls).toEqual(["media:image/png:resultado.png"]);
    expect(captions).toEqual(["*SARA - CASA FIAES:*\nOlha o resultado 💛"]);
    const [m] = await outMedia();
    expect(m).toMatchObject({ kind: "image", body: "*SARA - CASA FIAES:*\nOlha o resultado 💛", status: "sent", sentByUserId: uid });
  });

  it("vídeo com texto: uma mensagem só, legenda assinada", async () => {
    await attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: MP4 }, uid);
    await sendQuickReply(dealId, replyId, "Assista ao vídeo do Método Fiaes®", uid);
    expect(calls).toEqual(["media:video/mp4:metodo.mp4"]);
    expect(captions[0]).toBe("*SARA - CASA FIAES:*\nAssista ao vídeo do Método Fiaes®");
  });

  it("legenda que passa de 1024 caracteres (com a assinatura): volta ao jeito antigo, texto e depois o vídeo sem legenda", async () => {
    await attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: MP4 }, uid);
    const longo = "a".repeat(1010); // 1010 + "*SARA - CASA FIAES:*\n" (21) = 1031
    await sendQuickReply(dealId, replyId, longo, uid);
    expect(calls).toEqual([expect.stringMatching(/^text:\*SARA - CASA FIAES:\*\na{1010}$/), "media:video/mp4:metodo.mp4"]);
    expect(captions).toEqual([null]);
  });

  it("texto vazio: só a foto, sem legenda", async () => {
    await attachToQuickReply(replyId, { name: "resultado.png", mime: "image/png", data: PNG }, uid);
    await sendQuickReply(dealId, replyId, "   ", uid);
    expect(calls).toEqual(["media:image/png:resultado.png"]);
    expect(captions).toEqual([null]);
  });
});

describe("respostas prontas: o arquivo fica uma vez só no disco", () => {
  it("cada envio aponta para o arquivo da resposta pronta (nenhuma cópia por mensagem)", async () => {
    const a = await attachToQuickReply(replyId, { name: "resultado.png", mime: "image/png", data: PNG }, uid);
    await sendQuickReply(dealId, replyId, "Olha", uid);
    await sendQuickReply(dealId, replyId, "Olha de novo", uid);
    await sendQuickReply(dealId, replyId, "", uid);
    const sent = await outMedia();
    expect(sent).toHaveLength(3);
    expect(sent.every((m) => m.mediaPath === a.path)).toBe(true);
  });

  it("documento (texto e depois o arquivo) também aponta para o arquivo da resposta pronta", async () => {
    const a = await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    await sendQuickReply(dealId, replyId, "Segue", uid);
    expect((await outMedia()).map((m) => m.mediaPath)).toEqual([a.path]);
  });

  it("trocar ou tirar o anexo que já foi enviado NÃO apaga o arquivo (as mensagens antigas continuam mostrando)", async () => {
    const a = await attachToQuickReply(replyId, { name: "resultado.png", mime: "image/png", data: PNG }, uid);
    await sendQuickReply(dealId, replyId, "Olha", uid);
    const b = await attachToQuickReply(replyId, { name: "novo.png", mime: "image/png", data: PNG }, uid);
    expect(existsSync(path.join(mediaDir(), a.path))).toBe(true);
    await sendQuickReply(dealId, replyId, "Olha", uid);
    await detachFromQuickReply(replyId, uid);
    expect(existsSync(path.join(mediaDir(), b.path))).toBe(true);
    expect((await outMedia()).map((m) => m.mediaPath)).toEqual(expect.arrayContaining([a.path, b.path]));
  });
});

describe("respostas prontas: vídeo comprimido para ocupar pouco espaço", () => {
  it("o vídeo anexado é guardado comprimido (H.264 720p pelo ffmpeg) quando fica menor", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(40)); });
    const a = await attachToQuickReply(replyId, { name: "metodo.mov", mime: "video/quicktime", data: mp4(5000) }, uid);
    // O .mov do iPhone vira .mp4: o nome mostrado na caixa ("MP4") e o do download batem com o arquivo guardado.
    expect(a).toMatchObject({ kind: "video", mime: "video/mp4", name: "metodo.mp4" });
    expect(a.path).toMatch(/^resposta-.+\.mp4$/);
    expect((await readFile(path.join(mediaDir(), a.path))).length).toBe(40);
  });

  it("vídeo bruto acima de 16 MB entra se, comprimido, couber em 16 MB", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(2 * 1024 * 1024)); });
    const a = await attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: mp4(30 * 1024 * 1024) }, uid);
    expect((await readFile(path.join(mediaDir(), a.path))).length).toBe(2 * 1024 * 1024);
  });

  it("mesmo comprimido passou de 16 MB: mensagem clara e nada muda", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(17 * 1024 * 1024)); });
    await expect(attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: mp4(40 * 1024 * 1024) }, uid))
      .rejects.toThrow("Mesmo comprimido o vídeo passou de 16 MB. Corte um pedaço e tente de novo.");
    expect(quickReplyAttachment((await row()).meta)).toBeNull();
  });

  it("vídeo bruto acima de 64 MB é recusado; foto acima de 16 MB continua recusada", async () => {
    await expect(attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: mp4(65 * 1024 * 1024) }, uid)).rejects.toThrow("O vídeo passa de 64 MB");
    await expect(attachToQuickReply(replyId, { name: "f.png", mime: "image/png", data: Buffer.concat([PNG, Buffer.alloc(16 * 1024 * 1024)]) }, uid)).rejects.toThrow("O arquivo passa de 16 MB");
  });
});

describe("respostas prontas: \"A IA indica quando…\" (só universal com foto/vídeo, só a gestão)", () => {
  const gestao = () => ({ id: uid, canShare: true });
  it("a gestão grava o quando (sem espaço sobrando) e vazio limpa; o resto do meta fica", async () => {
    await attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: MP4 }, uid);
    await setQuickReplyIaQuando(replyId, "  a cliente perguntar sobre o   Método Fiaes  ", gestao());
    expect(quickReplyIaQuando((await row()).meta)).toBe("a cliente perguntar sobre o Método Fiaes");
    expect(quickReplyAttachment((await row()).meta)?.name).toBe("metodo.mp4");
    await setQuickReplyIaQuando(replyId, "", gestao());
    expect(quickReplyIaQuando((await row()).meta)).toBeNull();
    expect(quickReplyAttachment((await row()).meta)?.name).toBe("metodo.mp4");
  });

  it("a atendente não muda; pessoal, sem anexo ou com PDF é recusado; texto longo é recusado", async () => {
    await attachToQuickReply(replyId, { name: "metodo.mp4", mime: "video/mp4", data: MP4 }, uid);
    await expect(setQuickReplyIaQuando(replyId, "x", { id: uid, canShare: false })).rejects.toThrow("Só a gestão");
    await expect(setQuickReplyIaQuando(replyId, "x".repeat(201), gestao())).rejects.toThrow(/máximo 200/);
    await detachFromQuickReply(replyId, uid);
    await expect(setQuickReplyIaQuando(replyId, "x", gestao())).rejects.toThrow("Anexe uma foto ou um vídeo");
    await attachToQuickReply(replyId, { name: "tabela.pdf", mime: "application/pdf", data: PDF }, uid);
    await expect(setQuickReplyIaQuando(replyId, "x", gestao())).rejects.toThrow("Anexe uma foto ou um vídeo");
    const [{ id: pessoal }] = await db.insert(lists).values({ kind: "quick_reply", label: "minha-l5", body: "Oi", meta: { ownerId: uid } }).returning();
    await attachToQuickReply(pessoal, { name: "f.png", mime: "image/png", data: PNG }, uid);
    await expect(setQuickReplyIaQuando(pessoal, "x", gestao())).rejects.toThrow("Só a resposta universal");
  });
});
