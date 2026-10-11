import { unlink } from "node:fs/promises";
import path from "node:path";
import { and, eq, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";
import { mediaDir } from "./media";

/** Caminho do arquivo só se ficar DENTRO de MEDIA_DIR (nada de `..` nem caminho absoluto vindo do banco). */
export function safeMediaFile(rel: string): string | null {
  const root = path.resolve(mediaDir());
  const full = path.resolve(root, rel);
  return !path.isAbsolute(rel) && full.startsWith(root + path.sep) ? full : null;
}

const monthsBefore = (now: Date, months: number) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - months); return d; };

/**
 * Retenção de mídia: apaga do disco o arquivo das mensagens com mais de `months` meses, mantém a mensagem e marca `media_purged_at`
 * (a tela mostra "Mídia expirada"). `months = null` (configuração "nunca") não apaga nada. Arquivo que já sumiu do disco só é marcado.
 */
export async function purgeExpiredMedia(now: Date, months: number | null = 12): Promise<{ purged: number }> {
  if (months == null) return { purged: 0 };
  const rows = await db.select({ id: messages.id, path: messages.mediaPath }).from(messages)
    .where(and(isNotNull(messages.mediaPath), isNull(messages.mediaPurgedAt), lt(messages.createdAt, monthsBefore(now, months)))).limit(2000);
  let purged = 0;
  for (const r of rows) {
    const file = r.path ? safeMediaFile(r.path) : null;
    if (!file) { console.error("[retenção] caminho fora de MEDIA_DIR ignorado", r.id); continue; }
    try { await unlink(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") { console.error("[retenção] não apagou", r.id, (e as Error).message); continue; } }
    await db.update(messages).set({ mediaPath: null, mediaPurgedAt: now }).where(eq(messages.id, r.id));
    purged++;
  }
  return { purged };
}
