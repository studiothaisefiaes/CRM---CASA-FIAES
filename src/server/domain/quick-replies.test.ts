import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, lists, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { attachToQuickReply, detachFromQuickReply, quickReplyAttachment, sendQuickReply, setQuickReplyFolder } from "./quick-replies";
import { mediaDir } from "../whatsapp/media";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";

const PDF = Buffer.from("%PDF-1.7 tabela de precos");
const calls: string[] = []; let failText = false; let failMedia = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string) => { if (failText) throw new ProviderError("texto recusado", 500); calls.push(`text:${text}`); return { externalId: `T${calls.length}` }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string; name: string }) => { if (failMedia) throw new ProviderError("arquivo recusado", 500); calls.push(`media:${f.mime}:${f.name}`); return { externalId: `M${calls.length}` }; },
  sendAudio: async () => { calls.push("audio"); return { externalId: "A1" }; },
};
let uid = "", dealId = "", replyId = "";
beforeEach(async () => {
  calls.length = 0; failText = false; failMedia = false;
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const [ch] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId: ch.id, externalId: "IN1", phoneRaw: "71999990041", pushName: "Cliente Teste", body: "Quanto custa?" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  [{ id: replyId }] = await db.insert(lists).values({ kind: "quick_reply", label: "tabela-teste-l5", body: "Segue a nossa tabela 😊" }).returning();
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));
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
