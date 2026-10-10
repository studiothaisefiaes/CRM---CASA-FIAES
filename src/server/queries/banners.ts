import { and, asc, gt, inArray, isNotNull } from "drizzle-orm";
import { db } from "../db";
import { channels } from "../db/schema";
import { notRemovedChannel } from "../whatsapp/channel-removed";

export type ShellBanners = {
  /** Canais que caíram (erro ou desconectado). Pareando (aguardando QR) e removido não contam. */
  disconnected: { id: string; name: string }[];
  /** Canais em modo quieto: avisos pausados até `until` (ISO). */
  quiet: { id: string; name: string; until: string }[];
};

/** Estado de conexão para os banners do app. A tela se atualiza pelo evento SSE `canal_atualizado` (escopo `channels`). */
export async function getShellBanners(now = new Date()): Promise<ShellBanners> {
  const [down, quiet] = await Promise.all([
    db.select({ id: channels.id, name: channels.name }).from(channels)
      .where(and(notRemovedChannel, inArray(channels.status, ["erro", "desconectado"]))).orderBy(asc(channels.createdAt)),
    db.select({ id: channels.id, name: channels.name, until: channels.quietUntil }).from(channels)
      .where(and(notRemovedChannel, isNotNull(channels.quietUntil), gt(channels.quietUntil, now))).orderBy(asc(channels.createdAt)),
  ]);
  return { disconnected: down, quiet: quiet.map((c) => ({ id: c.id, name: c.name, until: c.until!.toISOString() })) };
}
