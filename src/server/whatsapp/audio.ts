import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";
import { mediaDir } from "./media";

/**
 * Áudios do WhatsApp (entrada e saída): o worker faz uma cópia .m4a (AAC), que toca no Safari/iPhone (ogg/opus não toca),
 * mede a duração e transcreve em português. Sem ffmpeg ou sem o transcritor instalado nada quebra: registra no log e segue
 * (o original continua tocando onde o navegador aceita ogg).
 */

/** Áudio longo: só os 10 primeiros minutos são transcritos. */
export const TRANSCRIBE_MAX_SECONDS = 600;
/** 1ª tentativa + no máximo 2 novas. */
export const MAX_TRANSCRIPT_ATTEMPTS = 3;
/** Áudio recente entra sozinho; o mais antigo só pelo scripts/transcrever-antigos.ts. */
const RECENT_DAYS = 3;

/** A ferramenta (ffmpeg, ffprobe, python/faster-whisper) não está instalada: não é falha do áudio, não gasta tentativa. */
export class AudioToolMissing extends Error {}

export type AudioTools = {
  /** Converte para .m4a (AAC) em `output`. */
  toM4a(input: string, output: string): Promise<void>;
  /** Duração em segundos (null quando não dá para saber). */
  duration(file: string): Promise<number | null>;
  /** Texto falado em português; vazio quando não há fala. */
  transcribe(file: string, opts: { maxSeconds: number }): Promise<string>;
};

type Run = { stdout: string };
function run(cmd: string, args: string[], opts: { timeoutMs: number; env?: NodeJS.ProcessEnv; missingExitCode?: number }): Promise<Run> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts.timeoutMs, maxBuffer: 4 * 1024 * 1024, env: opts.env ?? process.env, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      if (!err) return resolve({ stdout: String(stdout) });
      // code: "ENOENT" quando o programa não existe; número (código de saída) quando ele rodou e falhou.
      const e = err as Error & { code?: unknown; killed?: boolean };
      if (e.code === "ENOENT" || (opts.missingExitCode != null && e.code === opts.missingExitCode)) return reject(new AudioToolMissing(`${cmd} não instalado`));
      // Última linha do stderr: o motivo de verdade (traceback do Python, erro do ffmpeg).
      const why = String(stderr).trim().split("\n").pop()?.slice(0, 300) || `saída ${String(e.code)}`;
      reject(new Error(e.killed ? `${path.basename(cmd)}: passou do tempo (${Math.round(opts.timeoutMs / 1000)} s)` : `${path.basename(cmd)}: ${why}`));
    });
  });
}

/** TRANSCRIBE_CMD dividido em programa + argumentos (por espaço; sem aspas). */
const transcribeCmd = () => (process.env.TRANSCRIBE_CMD?.trim() || `python3 ${path.join(process.cwd(), "scripts", "transcrever.py")}`).split(/\s+/);

/** ffmpeg/ffprobe do sistema e o comando de transcrição (TRANSCRIBE_CMD, padrão `python3 scripts/transcrever.py`). */
export function defaultAudioTools(): AudioTools {
  return {
    async toM4a(input, output) {
      // -vn: alguns "áudios" vêm com capa; +faststart: o player começa a tocar antes de baixar tudo.
      await run("ffmpeg", ["-v", "error", "-y", "-i", input, "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", output], { timeoutMs: 120_000 });
    },
    async duration(file) {
      const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 30_000 });
      const s = Number.parseFloat(stdout.trim());
      return Number.isFinite(s) && s >= 0 ? s : null;
    },
    async transcribe(file, { maxSeconds }) {
      const [cmd, ...args] = transcribeCmd();
      const timeoutMs = Number(process.env.TRANSCRIBE_TIMEOUT_MS) || 8 * 60_000;
      // Saída 3 = o script não achou o faster-whisper (instalação incompleta).
      const { stdout } = await run(cmd, [...args, file], { timeoutMs, missingExitCode: 3, env: { ...process.env, TRANSCREVER_MAX_SEGUNDOS: String(maxSeconds) } });
      return stdout.trim();
    },
  };
}

let tools: AudioTools | null = null;
/** Testes trocam as ferramentas (null volta às de verdade). */
export function setAudioTools(t: AudioTools | null) { tools = t; }
/** As ferramentas em uso (as de verdade ou as dos testes): o ditado do "Sugerir resposta" usa o mesmo transcritor (src/server/ai/ditado.ts). */
export const audioTools = () => tools ?? defaultAudioTools();

/** Avisa uma vez por processo que falta instalar algo (docs/deploy-contabo.md › Áudio). */
const warned = new Set<string>();
const warnMissing = (what: string) => { if (warned.has(what)) return; warned.add(what); console.warn(`[áudio] ${what} — veja docs/deploy-contabo.md (Áudio: tocar e transcrever). O áudio original continua disponível.`); };

const AUDIO_WITH_FILE = and(eq(messages.kind, "audio"), isNotNull(messages.mediaPath), isNull(messages.mediaPurgedAt));

/** Áudio recém-baixado/enviado: entra na fila (a tela mostra "Transcrevendo…"). */
export async function markAudioPending(messageId: string) {
  await db.update(messages).set({ transcriptStatus: "pendente" }).where(and(eq(messages.id, messageId), eq(messages.kind, "audio"), isNull(messages.transcriptStatus)));
}

let running = false;

/**
 * Worker: um áudio por vez (nunca duas transcrições juntas). Para cada um: .m4a ao lado do original + duração, depois a transcrição.
 * Falha → "falhou" e nova tentativa na próxima rodada (até 3 no total). Ferramenta ausente → não mexe no status nem nas tentativas.
 */
export async function processPendingAudio(limit = 5, opts: { budgetMs?: number } = {}) {
  // Teto da rodada: depois de 5 min não começa outro áudio (5 + 8 de timeout < 15 min, quando o job do pg-boss expira).
  const budgetMs = opts.budgetMs ?? 5 * 60_000, t0 = Date.now();
  const out = { tried: 0, converted: 0, transcribed: 0, silent: 0, failed: 0, missing: false };
  if (running) return out;
  running = true;
  try {
    const t = audioTools();
    const rows = await db.select({ id: messages.id, mediaPath: messages.mediaPath, playbackPath: messages.playbackPath, duration: messages.mediaDurationSec, attempts: messages.transcriptAttempts, status: messages.transcriptStatus })
      .from(messages)
      .where(and(AUDIO_WITH_FILE, or(
        and(isNull(messages.transcriptStatus), gt(messages.createdAt, sql`now() - make_interval(days => ${RECENT_DAYS})`)),
        eq(messages.transcriptStatus, "pendente"),
        and(eq(messages.transcriptStatus, "falhou"), lt(messages.transcriptAttempts, MAX_TRANSCRIPT_ATTEMPTS)),
      )))
      .orderBy(desc(messages.createdAt)).limit(limit);
    let transcriberMissing = false;
    for (const r of rows) {
      if (out.tried > 0 && Date.now() - t0 > budgetMs) break;
      out.tried++;
      const original = path.join(mediaDir(), r.mediaPath!);
      let playbackPath = r.playbackPath;
      let duration = r.duration;
      if (!playbackPath) {
        const name = `${r.id}.m4a`;
        try { await t.toM4a(original, path.join(mediaDir(), name)); playbackPath = name; out.converted++; }
        catch (e) { if (e instanceof AudioToolMissing) { out.missing = true; warnMissing("ffmpeg não instalado: o áudio fica só no original (ogg)"); } else console.error("[áudio] não converteu", r.id, (e as Error).message); }
      }
      if (duration == null) {
        try { const s = await t.duration(playbackPath ? path.join(mediaDir(), playbackPath) : original); duration = s == null ? null : Math.min(32_767, Math.round(s)); }
        catch (e) { if (e instanceof AudioToolMissing) out.missing = true; else console.error("[áudio] sem duração", r.id, (e as Error).message); }
      }
      if (playbackPath !== r.playbackPath || duration !== r.duration)
        await db.update(messages).set({ playbackPath, mediaDurationSec: duration }).where(eq(messages.id, r.id));
      if (transcriberMissing) continue;
      try {
        const text = (await t.transcribe(playbackPath ? path.join(mediaDir(), playbackPath) : original, { maxSeconds: TRANSCRIBE_MAX_SECONDS })).trim();
        await db.update(messages).set(text ? { transcript: text, transcriptStatus: "pronta" } : { transcript: null, transcriptStatus: "sem_fala" }).where(eq(messages.id, r.id));
        if (text) out.transcribed++; else out.silent++;
      } catch (e) {
        if (e instanceof AudioToolMissing) {
          // Sem transcritor: volta ao "não enfileirado" (a tela não fica em "Transcrevendo…" para sempre); não gasta tentativa.
          transcriberMissing = true; out.missing = true;
          warnMissing("transcritor não instalado (TRANSCRIBE_CMD / faster-whisper)");
          if (r.status === "pendente") await db.update(messages).set({ transcriptStatus: null }).where(eq(messages.id, r.id));
          continue;
        }
        out.failed++;
        console.error("[áudio] transcrição falhou", r.id, (e as Error).message);
        await db.update(messages).set({ transcriptStatus: "falhou", transcriptAttempts: sql`${messages.transcriptAttempts} + 1` }).where(eq(messages.id, r.id));
      }
    }
  } finally { running = false; }
  return out;
}

/** Áudios dos últimos `days` dias ainda sem transcrição (nunca enfileirados). */
const oldAudioWhere = (days: number) => and(AUDIO_WITH_FILE, isNull(messages.transcriptStatus), gt(messages.createdAt, sql`now() - make_interval(days => ${days})`));

/** Ensaio do scripts/transcrever-antigos.ts: quantos e quanto tempo (duração medida, ou estimada pelo tamanho do arquivo: ~2 KB/s no opus do WhatsApp). */
export async function planOldAudio(days: number) {
  const rows = await db.select({ id: messages.id, mediaPath: messages.mediaPath, duration: messages.mediaDurationSec }).from(messages).where(oldAudioWhere(days));
  let seconds = 0, estimated = 0;
  for (const r of rows) {
    if (r.duration != null) { seconds += r.duration; continue; }
    const size = await stat(path.join(mediaDir(), r.mediaPath!)).then((s) => s.size, () => 0);
    seconds += Math.round(size / 2000); estimated++;
  }
  return { count: rows.length, seconds, estimated };
}

/** Enfileira (status "pendente"); o worker vai processando de 5 em 5 por minuto, um por vez. */
export async function queueOldAudio(days: number) {
  const ids = (await db.select({ id: messages.id }).from(messages).where(oldAudioWhere(days))).map((r) => r.id);
  if (!ids.length) return 0;
  await db.update(messages).set({ transcriptStatus: "pendente" }).where(and(inArray(messages.id, ids), isNull(messages.transcriptStatus)));
  return ids.length;
}
