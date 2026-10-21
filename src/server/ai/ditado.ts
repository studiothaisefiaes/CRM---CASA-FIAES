import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AudioToolMissing, audioTools } from "../whatsapp/audio";
import { UserFacingError } from "../domain/errors";

/**
 * Ditado do "Sobre o quê?" (Cati 16/10: "ela quer ditar um áudio e a IA montar a resposta"): a atendente grava um áudio curto no navegador,
 * o servidor transcreve com o MESMO transcritor dos áudios do WhatsApp (src/server/whatsapp/audio.ts, faster-whisper via TRANSCRIBE_CMD)
 * e devolve o texto, que vira a ORDEM DA ATENDENTE da sugestão. Nada é guardado: o arquivo temporário é apagado na hora e nada é enviado.
 */

/** Ditado é curto: só os 2 primeiros minutos são transcritos. */
export const DITADO_MAX_SECONDS = 120;
/** ~2 min de opus/aac cabem folgados em 4 MB. */
export const DITADO_MAX_BYTES = 4 * 1024 * 1024;
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac", "audio/mpeg": "mp3", "audio/wav": "wav" };

/** Um ditado por vez neste processo (o servidor é pequeno): o seguinte espera o anterior terminar. */
let fila: Promise<unknown> = Promise.resolve();

export async function transcreverDitado(bytes: Uint8Array, mime: string): Promise<string> {
  const ext = EXT[mime.split(";")[0].trim().toLowerCase()];
  if (!ext) throw new UserFacingError("Formato de áudio não aceito. Grave de novo pelo botão Falar.");
  if (!bytes.length) throw new UserFacingError("O áudio veio vazio. Grave de novo.");
  if (bytes.length > DITADO_MAX_BYTES) throw new UserFacingError("Áudio longo demais. Fale em até 2 minutos.");
  const run = fila.then(async () => {
    const dir = path.join(os.tmpdir(), "crm-ditado");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${randomUUID()}.${ext}`);
    try {
      await writeFile(file, bytes);
      return (await audioTools().transcribe(file, { maxSeconds: DITADO_MAX_SECONDS })).replace(/\s+/g, " ").trim();
    } catch (e) {
      if (e instanceof AudioToolMissing) throw new UserFacingError("A transcrição de áudio não está instalada no servidor. Digite o pedido.");
      console.error("[ditado] transcrição falhou", (e as Error).message);
      throw new UserFacingError("Não deu para entender o áudio. Tente de novo ou digite.");
    } finally {
      await rm(file, { force: true }).catch(() => {});
    }
  });
  fila = run.catch(() => {});
  const text = await run;
  if (!text) throw new UserFacingError("Não deu para ouvir nada. Fale mais perto do microfone.");
  return text;
}
