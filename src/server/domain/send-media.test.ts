import { vi, it, expect, beforeEach, afterEach } from "vitest";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, dealEvents, deals, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { sendFromCrm, sendMediaFromCrm, markConversationRead, sendHooks } from "./send";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ingestEvolution } from "../whatsapp/webhook";
import { ensureMedia } from "../whatsapp/media";
import { resetDb } from "../../../test/db";

type Quoted = { externalId: string; fromMe: boolean; text: string };
let uid = ""; let dealId = ""; let chId = ""; const calls: string[] = []; let failRead = false;
const quotes: (Quoted | undefined)[] = []; let beforeReturn: ((k: string, mime: string) => Promise<void>) | null = null;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string, q?: Quoted) => { calls.push(`text:${text}:${q?.externalId ?? ""}`); quotes.push(q); return { externalId: "OUT1" }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string }, _c: string | null, q?: Quoted) => { calls.push(`media:${f.mime}`); quotes.push(q); await beforeReturn?.("media", f.mime); return { externalId: "OUT2" }; },
  sendAudio: async (_i: string, _t: string, _d: Buffer, q?: Quoted) => { calls.push("audio"); quotes.push(q); return { externalId: "OUT3" }; },
  markRead: async (_i: string, _t: string, ids: string[]) => { if (failRead) throw new Error("evolution fora do ar"); calls.push(`read:${ids.join(",")}`); },
};
beforeEach(async () => {
  calls.length = 0; quotes.length = 0; beforeReturn = null; failRead = false; await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" });
  chId = (await db.select().from(channels))[0].id;
  const r = await recordInbound({ channelId: chId, externalId: "IN1", phoneRaw: "71999995555", body: "oi" });
  if (!("dealId" in r)) throw new Error(); dealId = r.dealId; setWhatsappProvider(fake);
});
afterEach(() => { setWhatsappProvider(null); delete sendHooks.beforeConfirm; });

it("envia PDF e grava como documento", async () => {
  await sendMediaFromCrm(dealId, { name: "tabela.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.7 ...") }, "Nossa tabela", uid);
  expect(calls).toContain("media:application/pdf");
  const out = (await db.select().from(messages)).find((m) => m.direction === "out")!;
  expect(out.kind).toBe("document");
  expect(out.mediaPath).toBeTruthy(); expect(out.mediaMime).toBe("application/pdf"); expect(out.status).toBe("sent");
});
it("recusa html disfarçado", async () => {
  await expect(sendMediaFromCrm(dealId, { name: "x.jpg", mime: "image/jpeg", data: Buffer.from("<html>") }, null, uid)).rejects.toThrow(/tipo de arquivo/);
});
it("recusa arquivo acima de 16 MB", async () => {
  const big = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16 * 1024 * 1024)]);
  await expect(sendMediaFromCrm(dealId, { name: "x.pdf", mime: "application/pdf", data: big }, null, uid)).rejects.toThrow(/16 MB/);
});
it("áudio vai como mensagem de voz", async () => {
  await sendMediaFromCrm(dealId, { name: "voz.ogg", mime: "audio/ogg", data: Buffer.from("OggS\0\0\0\0") }, null, uid);
  expect(calls).toContain("audio");
  const out = (await db.select().from(messages)).find((m) => m.direction === "out")!;
  expect(out.kind).toBe("audio");
  // entra na fila de conversão/transcrição do worker (a tela mostra "Transcrevendo…")
  expect(out.transcriptStatus).toBe("pendente");
});
it("gravação do Safari (audio/mp4 com moov de áudio) vira áudio", async () => {
  const mp4 = Buffer.concat([Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isom"), Buffer.from("\0\0\0\x21hdlr\0\0\0\0\0\0\0\0soun\0\0\0\0")]);
  await sendMediaFromCrm(dealId, { name: "voz.m4a", mime: "audio/mp4", data: mp4 }, null, uid);
  expect(calls).toContain("audio");
});
it("gravação webm do Chrome (audio/webm) vira áudio", async () => {
  await sendMediaFromCrm(dealId, { name: "voz.webm", mime: "audio/webm", data: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 0]) }, null, uid);
  expect(calls).toContain("audio");
});
it("responde citando", async () => {
  const [inMsg] = await db.select().from(messages);
  await sendFromCrm(dealId, "Sim!", uid, { quoteMessageId: inMsg.id });
  expect(calls).toContain("text:*ANA - CASA FIAES:*\nSim!:IN1");
  expect((await db.select().from(messages)).find((m) => m.direction === "out")!.quotedBody).toBe("oi");
});
it("marca como lido ao abrir e só as novas na vez seguinte", async () => {
  await markConversationRead(dealId, uid);
  expect(calls).toContain("read:IN1");
  expect((await db.select().from(dealEvents).where(eq(dealEvents.type, "lido"))).length).toBe(1);
  calls.length = 0;
  await markConversationRead(dealId, uid);
  expect(calls).toEqual([]);
  await recordInbound({ channelId: (await db.select().from(channels))[0].id, externalId: "IN2", phoneRaw: "71999995555", body: "e aí?", at: new Date(Date.now() + 5000) });
  await markConversationRead(dealId, uid);
  expect(calls).toEqual(["read:IN2"]);
});
it("Evolution fora do ar não quebra a abertura e tenta de novo depois", async () => {
  failRead = true;
  await expect(markConversationRead(dealId, uid)).resolves.toBeUndefined();
  expect((await db.select().from(dealEvents).where(eq(dealEvents.type, "lido"))).length).toBe(0);
  failRead = false;
  await markConversationRead(dealId, uid);
  expect(calls).toContain("read:IN1");
});

const echo = (id: string, message: Record<string, unknown>) => ingestEvolution({ event: "send.message", instance: "rec", data: {
  key: { remoteJid: "5571999995555@s.whatsapp.net", fromMe: true, id }, message, messageType: "x", messageTimestamp: Math.floor(Date.now() / 1000) } } as never);
const outs = async () => (await db.select().from(messages)).filter((m) => m.direction === "out");

it("citação leva o objeto completo (id, fromMe, texto) ao provider e grava quotedBody", async () => {
  const [inMsg] = await db.select().from(messages);
  await sendFromCrm(dealId, "Sim!", uid, { quoteMessageId: inMsg.id });
  expect(quotes[0]).toEqual({ externalId: "IN1", fromMe: false, text: "oi" });
  await db.update(messages).set({ kind: "image", body: null }).where(eq(messages.id, inMsg.id));
  await sendFromCrm(dealId, "Linda!", uid, { quoteMessageId: inMsg.id });
  expect(quotes[1]).toEqual({ externalId: "IN1", fromMe: false, text: "📷 Foto" });
});
it("citada sem externalId: segue sem citação e não grava quotedBody", async () => {
  const [inMsg] = await db.select().from(messages);
  await db.update(messages).set({ externalId: null }).where(eq(messages.id, inMsg.id));
  await sendFromCrm(dealId, "Sim!", uid, { quoteMessageId: inMsg.id });
  expect(quotes[0]).toBeUndefined();
  expect((await outs())[0].quotedBody).toBeNull();
});
it("áudio recusa legenda", async () => {
  await expect(sendMediaFromCrm(dealId, { name: "v.ogg", mime: "audio/ogg", data: Buffer.from("OggS\0\0\0\0") }, "legenda", uid)).rejects.toThrow(/legenda/);
  expect(calls).toEqual([]);
});
it("áudio vai com a citação", async () => {
  const [inMsg] = await db.select().from(messages);
  await sendMediaFromCrm(dealId, { name: "v.ogg", mime: "audio/ogg", data: Buffer.from("OggS\0\0\0\0") }, null, uid, { quoteMessageId: inMsg.id });
  expect(quotes[0]).toEqual({ externalId: "IN1", fromMe: false, text: "oi" });
  expect((await outs())[0].quotedBody).toBe("oi");
});
it("eco do WhatsApp chegando ANTES do retorno do envio: foto sem legenda não duplica", async () => {
  beforeReturn = async () => { await echo("OUT2", { imageMessage: { mimetype: "image/png", caption: "" } }); };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  await sendMediaFromCrm(dealId, { name: "f.png", mime: "image/png", data: png }, null, uid);
  const o = await outs();
  expect(o).toHaveLength(1);
  expect(o[0]).toMatchObject({ externalId: "OUT2", kind: "image", status: "sent", sentByUserId: uid });
  expect(o[0].mediaPath).toBeTruthy();
});
it("eco antes do retorno: documento não duplica", async () => {
  beforeReturn = async () => { await echo("OUT2", { documentMessage: { mimetype: "application/pdf", fileName: "tabela.pdf" } }); };
  await sendMediaFromCrm(dealId, { name: "tabela.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.7 x") }, null, uid);
  const o = await outs();
  expect(o).toHaveLength(1);
  expect(o[0]).toMatchObject({ externalId: "OUT2", kind: "document", sentByUserId: uid });
});
it("se a linha do eco já existe (não casou), absorve: uma linha só, sem erro", async () => {
  beforeReturn = async () => { await db.insert(messages).values({ dealId, contactId: (await db.select().from(messages))[0].contactId, channelId: chId, externalId: "OUT2", direction: "out", kind: "image", status: "sent" }); };
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  await expect(sendMediaFromCrm(dealId, { name: "f.png", mime: "image/png", data: png }, null, uid)).resolves.toBeDefined();
  const o = await outs();
  expect(o).toHaveLength(1);
  expect(o[0]).toMatchObject({ externalId: "OUT2", sentByUserId: uid });
  expect(o[0].mediaPath).toBeTruthy();
  expect((await db.select().from(messages).where(isNotNull(messages.externalId))).length).toBe(2);
});
it("documento com legenda baixa com o nome do arquivo, não com a legenda", async () => {
  await sendMediaFromCrm(dealId, { name: "tabela.pdf", mime: "application/pdf", data: Buffer.from("%PDF-1.7 x") }, "Nossa tabela", uid);
  const f = await ensureMedia((await outs())[0].id);
  expect(f?.name).toBe("tabela.pdf");
});
it("corrida: o eco cria a linha entre a conferência e a confirmação, conclui sem erro e sem duplicar", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  // Roda depois da conferência do eco (que não achou nada) e antes do UPDATE do id externo.
  sendHooks.beforeConfirm = async () => { await echo("OUT2", { imageMessage: { mimetype: "image/png" } }); };
  // O eco aqui não casa com a pendente (já "sent"): força a linha separada do cenário de corrida.
  const origin = fake.sendMedia;
  fake.sendMedia = async (...a: Parameters<typeof origin>) => { const r = await origin(...a); await db.update(messages).set({ status: "sent" }).where(eq(messages.direction, "out")); return r; };
  try {
    await expect(sendMediaFromCrm(dealId, { name: "f.png", mime: "image/png", data: png }, null, uid)).resolves.toBeDefined();
  } finally { fake.sendMedia = origin; }
  const o = await outs();
  expect(o).toHaveLength(1);
  expect(o[0]).toMatchObject({ externalId: "OUT2", sentByUserId: uid });
  expect(o[0].mediaPath).toBeTruthy();
});
it("envio pelo CRM leva a assinatura de quem está logada na primeira linha", async () => {
  await db.update(users).set({ signature: "SARA" }).where(eq(users.id, uid));
  await sendFromCrm(dealId, "Oi, tudo bem?", uid);
  expect(calls).toContain("text:*SARA - CASA FIAES:*\nOi, tudo bem?:");
  expect((await outs())[0]).toMatchObject({ body: "*SARA - CASA FIAES:*\nOi, tudo bem?", sentByUserId: uid, sentVia: "crm", status: "sent" });
});
it("sem assinatura cadastrada assina com o 1º nome em maiúsculas", async () => {
  await sendFromCrm(dealId, "Oi!", uid);
  expect(calls).toContain("text:*ANA - CASA FIAES:*\nOi!:");
});
it("texto que já começa com assinatura não ganha outra", async () => {
  await db.update(users).set({ signature: "SARA" }).where(eq(users.id, uid));
  await sendFromCrm(dealId, "*SARA - CASA FIAES:*\nDe novo", uid);
  expect(calls).toContain("text:*SARA - CASA FIAES:*\nDe novo:");
});
it("visto azul ao abrir: só a dona; a gestão espiando não manda", async () => {
  const [g] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  await markConversationRead(dealId, g.id);
  expect(calls).toEqual([]);
  await markConversationRead(dealId, uid); // Ana é a dona (recebeu pela distribuição)
  expect(calls).toEqual(["read:IN1"]);
});
it("conversa sem dona: abrir não manda visto; responder manda", async () => {
  await db.update(deals).set({ ownerId: null }).where(eq(deals.id, dealId));
  await markConversationRead(dealId, uid);
  expect(calls).toEqual([]);
  await sendFromCrm(dealId, "Oi!", uid);
  // O visto vai depois, sem segurar a resposta do envio.
  expect(calls[0]).toBe("text:*ANA - CASA FIAES:*\nOi!:");
  await vi.waitFor(() => expect(calls).toEqual(["text:*ANA - CASA FIAES:*\nOi!:", "read:IN1"]));
});
it("eco do envio assinado pelo CRM chegando antes do retorno: uma linha só, autora a pessoa logada, por onde = CRM e nenhum aviso", async () => {
  await db.update(users).set({ signature: "ANA" }).where(eq(users.id, uid));
  const origin = fake.sendText;
  fake.sendText = async (...a: Parameters<typeof origin>) => { const r = await origin(...a); await echo("OUT1", { conversation: a[2] }); return r; };
  try { await sendFromCrm(dealId, "Oi!", uid); } finally { fake.sendText = origin; }
  const o = await outs();
  expect(o).toHaveLength(1);
  expect(o[0]).toMatchObject({ externalId: "OUT1", body: "*ANA - CASA FIAES:*\nOi!", sentByUserId: uid, sentVia: "crm", status: "sent" });
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(d).toMatchObject({ lastReplyById: uid, lastReplyVia: "crm" });
  expect(await db.select().from(alerts).where(eq(alerts.type, "respondida_por_outra"))).toHaveLength(0);
});
