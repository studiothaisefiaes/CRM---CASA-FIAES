import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sniffMime } from "../security/sniff";
import { UserFacingError } from "../domain/errors";

/**
 * Vídeo guardado no CRM (anexo de resposta pronta e Biblioteca; pedido do dono 24/10: "sem gastar tanto espaço"): antes de ir para o disco,
 * o vídeo é refeito com o ffmpeg em H.264 de até 720p de altura, AAC e +faststart (o player começa antes de baixar tudo). Fica com o
 * comprimido só se ele for menor. ffmpeg ausente ou falhando NUNCA bloqueia: guarda o original e registra no log.
 * O vídeo enviado direto pela caixa de mensagem não passa por aqui (vai como a atendente escolheu, até 16 MB).
 */

/** Vídeo bruto aceito para comprimir; o limite de verdade (16 MB, ou o da Biblioteca) vale DEPOIS de comprimir. */
export const MAX_RAW_VIDEO_BYTES = 64 * 1024 * 1024;
/** Um vídeo de 64 MB em 1080p leva menos de 1 min no veryfast; passou disto, algo travou. */
const TIMEOUT_MS = 5 * 60_000;

/** Converte `input` em `output` (.mp4). Injetável para os testes (`setVideoCompressor`). */
export type VideoCompressor = (input: string, output: string) => Promise<void>;

/** O ffmpeg do sistema: o do PATH, senão os lugares de costume (produção /usr/bin, Mac /opt/homebrew/bin). null = não instalado. */
export function findFfmpeg(): string | null {
  for (const dir of [...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean), "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"]) {
    const f = path.join(dir, "ffmpeg");
    if (existsSync(f)) return f;
  }
  return null;
}

/**
 * H.264 (libx264, CRF 28, veryfast), o lado MENOR até 720 mantendo a proporção (deitado 1280x720, em pé 720x1280; largura e altura pares:
 * o H.264 em 4:2:0 exige), yuv420p (vídeo de iPhone em 10 bits não tocaria em todo celular), AAC 96k, só o 1º vídeo e o 1º áudio (iPhone
 * traz trilhas de metadados) e +faststart. 2 threads: o servidor também atende a equipe enquanto comprime.
 * A rotação do iPhone (metadado) é aplicada pelo ffmpeg antes da escala, então "em pé" já chega em pé aqui.
 * Entrada só como MP4/MOV e só do disco (`-f mov`, `-protocol_whitelist file`): o arquivo vem de fora e o ffmpeg nunca segue referência
 * para outro arquivo nem para a rede. O nome que a pessoa deu ao arquivo nunca chega ao ffmpeg (os caminhos são da pasta temporária).
 */
const SCALE = "scale='if(gte(iw,ih),-2,min(720,trunc(iw/2)*2))':'if(gte(iw,ih),min(720,trunc(ih/2)*2),-2)'";
export const ffmpegCompressor: VideoCompressor = (input, output) => new Promise((resolve, reject) => {
  const bin = findFfmpeg();
  if (!bin) return reject(new Error("ffmpeg não instalado"));
  execFile(bin, ["-v", "error", "-y", "-protocol_whitelist", "file", "-f", "mov", "-i", input, "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", SCALE, "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-threads", "2", output],
  { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, killSignal: "SIGKILL" }, (err, _out, stderr) => {
    if (!err) return resolve();
    const e = err as Error & { killed?: boolean };
    reject(new Error(e.killed ? "ffmpeg passou do tempo" : String(stderr).trim().split("\n").pop()?.slice(0, 300) || e.message));
  });
});

let override: VideoCompressor | null = null;
/** Só para testes: troca o ffmpeg por uma função falsa (null volta ao ffmpeg de verdade). */
export function setVideoCompressor(fn: VideoCompressor | null) { override = fn; }

/** Comprime; devolve o original quando o comprimido não é menor, não é vídeo ou o ffmpeg falhou. */
export async function compressVideo(data: Buffer, run: VideoCompressor = override ?? ffmpegCompressor): Promise<{ data: Buffer; compressed: boolean }> {
  const dir = await mkdtemp(path.join(tmpdir(), "cf-video-"));
  try {
    const input = path.join(dir, "original"), output = path.join(dir, "comprimido.mp4");
    await writeFile(input, data);
    await run(input, output);
    const out = await readFile(output);
    if (sniffMime(out.subarray(0, 256 * 1024)) !== "video/mp4") throw new Error("a saída não é um vídeo mp4");
    return out.length < data.length ? { data: out, compressed: true } : { data, compressed: false };
  } catch (e) {
    console.error("[vídeo] não comprimiu; guardando o original:", e instanceof Error ? e.message : e);
    return { data, compressed: false };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Vídeo para guardar: aceita até 64 MB bruto, comprime e exige caber em `maxBytes` depois disso. */
export async function shrinkVideo(data: Buffer, maxBytes: number): Promise<Buffer> {
  if (data.length > MAX_RAW_VIDEO_BYTES) throw new UserFacingError("O vídeo passa de 64 MB. Corte um pedaço e tente de novo.");
  const { data: out, compressed } = await compressVideo(data);
  const mb = Math.round(maxBytes / 1024 / 1024);
  if (out.length > maxBytes) {
    // Sem o comprimido (ffmpeg ausente/falhou, ou não ficou menor) a mensagem não pode dizer "mesmo comprimido".
    throw new UserFacingError(compressed ? `Mesmo comprimido o vídeo passou de ${mb} MB. Corte um pedaço e tente de novo.`
      : `Não deu para comprimir o vídeo agora e ele passa de ${mb} MB. Tente um vídeo menor ou avise a gestão.`);
  }
  return out;
}
