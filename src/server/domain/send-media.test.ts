import { it, expect, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, dealEvents, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { sendFromCrm, sendMediaFromCrm, markConversationRead } from "./send";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { resetDb } from "../../../test/db";

let uid = ""; let dealId = ""; const calls: string[] = []; let failRead = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _t: string, text: string, q?: string) => { calls.push(`text:${text}:${q ?? ""}`); return { externalId: "OUT1" }; },
  sendMedia: async (_i: string, _t: string, f: { mime: string }) => { calls.push(`media:${f.mime}`); return { externalId: "OUT2" }; },
  sendAudio: async () => { calls.push("audio"); return { externalId: "OUT3" }; },
  markRead: async (_i: string, _t: string, ids: string[]) => { if (failRead) throw new Error("evolution fora do ar"); calls.push(`read:${ids.join(",")}`); },
};
beforeEach(async () => {
  calls.length = 0; failRead = false; await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" });
  const r = await recordInbound({ channelId: (await db.select().from(channels))[0].id, externalId: "IN1", phoneRaw: "71999995555", body: "oi" });
  if (!("dealId" in r)) throw new Error(); dealId = r.dealId; setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

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
  expect((await db.select().from(messages)).find((m) => m.direction === "out")!.kind).toBe("audio");
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
  expect(calls).toContain("text:Sim!:IN1");
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
