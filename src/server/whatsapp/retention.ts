import { unlink } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, isNotNull, isNull, lt, notInArray, notLike } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";
import { safeMediaFile } from "./media";
import { removeThumbs } from "./thumbs";
import { getMediaRetentionMonths } from "../domain/messaging-settings";

// A conferência do caminho mora em media.ts (a tela também usa ao servir a mídia); continua exportada daqui para quem já importava.
export { safeMediaFile };

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
export async function purgeExpiredMedia(now: Date, months: number | null, opts: { batch?: number; maxBatches?: number } = {}): Promise<{ purged: number }> {
  if (months == null) return { purged: 0 };
  const batch = opts.batch ?? RETENTION_BATCH, maxBatches = opts.maxBatches ?? RETENTION_MAX_BATCHES;
  const cutoff = monthsBefore(now, months);
  const failed: string[] = [];
  let purged = 0;
  for (let lot = 0; lot < maxBatches; lot++) {
    const rows = await db.select({ id: messages.id, path: messages.mediaPath, playback: messages.playbackPath }).from(messages)
      .where(and(isNotNull(messages.mediaPath), isNull(messages.mediaPurgedAt),
        // A Biblioteca e o anexo das respostas prontas nunca são apagados pela retenção: várias mensagens apontam para o MESMO arquivo
        // (biblioteca/<id>.<ext>, resposta-<id>.<ext>; o envio não copia, 24/10). Apagar pela mensagem velha quebraria as outras e a própria resposta.
        notLike(messages.mediaPath, "biblioteca/%"), notLike(messages.mediaPath, "resposta-%"), lt(messages.createdAt, cutoff), failed.length ? notInArray(messages.id, failed) : undefined))
      .orderBy(asc(messages.createdAt)).limit(batch);
    if (!rows.length) break;
    const gone: string[] = [];
    for (const r of rows) {
      const file = r.path ? safeMediaFile(r.path) : null;
      if (!file) { console.error("[retenção] caminho fora de MEDIA_DIR: marcado sem apagar", r.id); await db.update(messages).set({ mediaPurgedAt: now }).where(eq(messages.id, r.id)); continue; }
      try { await unlink(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") { console.error("[retenção] não apagou", r.id, (e as Error).message); failed.push(r.id); continue; } }
      gone.push(path.basename(file));
      // Cópia .m4a do áudio (whatsapp/audio.ts): vai junto. Falha aqui não segura o original.
      const copy = r.playback ? safeMediaFile(r.playback) : null;
      if (copy) await unlink(copy).catch((e) => { if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("[retenção] não apagou a cópia m4a", r.id, (e as Error).message); });
      await db.update(messages).set({ mediaPath: null, playbackPath: null, mediaPurgedAt: now }).where(eq(messages.id, r.id));
      purged++;
    }
    // Miniaturas das fotos apagadas (thumbs.ts): vão junto, uma leitura da pasta por lote.
    await removeThumbs(gone);
  }
  return { purged };
}

/**
 * Job diário `retencao-midia`: usa o prazo escolhido pela gestão em Configurações › WhatsApp.
 * Sem prazo escolhido ("Não apagar", o padrão) não apaga nada e só registra no log que a retenção está desligada.
 */
export async function runMediaRetention(now = new Date()): Promise<{ purged: number; off: boolean }> {
  const months = await getMediaRetentionMonths();
  if (months == null) {
    console.log("[retenção de mídia] desligada: nenhum prazo escolhido em Configurações › WhatsApp (\"Não apagar\"); nada foi apagado.");
    return { purged: 0, off: true };
  }
  const r = await purgeExpiredMedia(now, months);
  if (r.purged) console.log("[retenção de mídia]", { meses: months, ...r });
  return { ...r, off: false };
}
