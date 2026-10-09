import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels } from "../db/schema";

/**
 * Modo quieto: logo depois de parear um número, o WhatsApp despeja o histórico e várias conversas antigas
 * parecem "esperando resposta". Enquanto o canal estiver quieto, o motor não gera aviso nem move lead desse canal.
 */
export async function isQuiet(channelId: string | null, now: Date): Promise<boolean> {
  if (!channelId) return false;
  const [ch] = await db.select({ quietUntil: channels.quietUntil }).from(channels).where(eq(channels.id, channelId));
  return !!ch?.quietUntil && ch.quietUntil > now;
}

export async function startQuiet(channelId: string, hours = 48, now = new Date()): Promise<Date> {
  const until = new Date(now.getTime() + hours * 3_600_000);
  await db.update(channels).set({ quietUntil: until }).where(eq(channels.id, channelId));
  return until;
}

export async function endQuiet(channelId: string): Promise<void> {
  await db.update(channels).set({ quietUntil: null }).where(eq(channels.id, channelId));
}
