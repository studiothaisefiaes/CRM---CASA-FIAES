import { unlink } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNotNull, isNull, lt, notInArray } from "drizzle-orm";
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

export const RETENTION_BATCH = 500;
/** Teto de segurança por execução: 50 lotes de 500 = 25.000 arquivos por noite. */
export const RETENTION_MAX_BATCHES = 50;

/**
 * Retenção de mídia: apaga do disco o arquivo das mensagens com mais de `months` meses, mantém a mensagem e marca `media_purged_at`
 * (a tela mostra "Mídia expirada"). `months = null` (configuração "nunca") não apaga nada. Arquivo que já sumiu do disco só é marcado.
 * Roda em lotes até esvaziar (com teto de lotes por execução). Linha com caminho fora de MEDIA_DIR NUNCA é apagada: é só marcada com
 * `media_purged_at` (o arquivo não é servido mesmo), para não ocupar a janela do lote; não conta em `purged`.
 * Falha ao apagar (permissão, por exemplo) fica de fora do resto da execução e é tentada de novo na próxima.
 */
export async function purgeExpiredMedia(now: Date, months: number | null = 12, opts: { batch?: number; maxBatches?: number } = {}): Promise<{ purged: number }> {
  if (months == null) return { purged: 0 };
  const batch = opts.batch ?? RETENTION_BATCH, maxBatches = opts.maxBatches ?? RETENTION_MAX_BATCHES;
  const cutoff = monthsBefore(now, months);
  const failed: string[] = [];
  let purged = 0;
  for (let lot = 0; lot < maxBatches; lot++) {
    const rows = await db.select({ id: messages.id, path: messages.mediaPath }).from(messages)
      .where(and(isNotNull(messages.mediaPath), isNull(messages.mediaPurgedAt), lt(messages.createdAt, cutoff), failed.length ? notInArray(messages.id, failed) : undefined))
      .orderBy(asc(messages.createdAt)).limit(batch);
    if (!rows.length) break;
    for (const r of rows) {
      const file = r.path ? safeMediaFile(r.path) : null;
      if (!file) { console.error("[retenção] caminho fora de MEDIA_DIR: marcado sem apagar", r.id); await db.update(messages).set({ mediaPurgedAt: now }).where(eq(messages.id, r.id)); continue; }
      try { await unlink(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") { console.error("[retenção] não apagou", r.id, (e as Error).message); failed.push(r.id); continue; } }
      await db.update(messages).set({ mediaPath: null, mediaPurgedAt: now }).where(eq(messages.id, r.id));
      purged++;
    }
  }
  return { purged };
}
