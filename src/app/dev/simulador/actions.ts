"use server";
import { notFound } from "next/navigation";
import { env } from "@/server/env";
import { assertUser } from "@/server/auth/session";
import { ingestEvolution } from "@/server/whatsapp/webhook";
import { db } from "@/server/db";
import { channels } from "@/server/db/schema";

/** Simula a Evolution chamando o webhook (só desenvolvimento). */
export async function simulateAction(input: { phone: string; name: string; text: string; fromMe: boolean; ad: boolean }) {
  if (!env().DEV_TOOLS) notFound();
  await assertUser();
  const [ch] = await db.select().from(channels).limit(1);
  const id = "SIM" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase();
  const r = await ingestEvolution({
    event: "messages.upsert", instance: ch?.instanceName ?? "simulador",
    data: {
      key: { remoteJid: `${input.phone.replace(/\D/g, "")}@s.whatsapp.net`, fromMe: input.fromMe, id },
      pushName: input.fromMe ? "Você" : input.name || null,
      message: input.ad ? { extendedTextMessage: { text: input.text, contextInfo: { externalAdReply: { title: "Anúncio" } } } } : { conversation: input.text },
      messageType: "conversation", messageTimestamp: Math.floor(Date.now() / 1000),
    },
  });
  return JSON.parse(JSON.stringify(r));
}
