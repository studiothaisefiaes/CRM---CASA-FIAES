import { and, eq, isNull, lte, or } from "drizzle-orm";
import { db } from "../db";
import { channels, type Channel } from "../db/schema";

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

/** QR lido há menos que isso conta como pareamento novo (o histórico vai chegar). */
const QR_RECENT_MS = 10 * 60_000;

/**
 * Liga o modo quieto só quando o canal acabou de ser pareado: não tinha número, o número mudou ou alguém leu o QR
 * há pouco. Queda de rede (mesmo número voltando sem QR) não silencia nada. Idempotente: não estende um modo quieto
 * que ainda está valendo (o webhook e a consulta de status da tela podem chegar os dois).
 * `before` é o canal como estava antes da mudança para "conectado".
 */
export async function startQuietIfPaired(before: Channel, phone: string | null | undefined, now = new Date()): Promise<boolean> {
  const phoneChanged = !!phone && !!before.phone && phone !== before.phone;
  const freshPair = before.status !== "conectado" && (!before.phone || (!!before.lastQrAt && now.getTime() - before.lastQrAt.getTime() <= QR_RECENT_MS));
  if (!phoneChanged && !freshPair) return false;
  const until = new Date(now.getTime() + 48 * 3_600_000);
  const rows = await db.update(channels).set({ quietUntil: until })
    .where(and(eq(channels.id, before.id), or(isNull(channels.quietUntil), lte(channels.quietUntil, now))))
    .returning({ id: channels.id });
  return rows.length > 0;
}

export async function endQuiet(channelId: string): Promise<void> {
  await db.update(channels).set({ quietUntil: null }).where(eq(channels.id, channelId));
}
