import { afterEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { AudioToolMissing, setAudioTools, type AudioTools } from "../whatsapp/audio";
import { DITADO_MAX_BYTES, DITADO_MAX_SECONDS, transcreverDitado } from "./ditado";

const seen: { file: string; bytes: string; maxSeconds: number; existia: boolean }[] = [];
const tools = (transcribe: AudioTools["transcribe"]): AudioTools => ({ toM4a: async () => {}, duration: async () => null, transcribe });
const ouve = (texto: string) => tools(async (file, o) => { seen.push({ file, bytes: readFileSync(file, "utf8"), maxSeconds: o.maxSeconds, existia: existsSync(file) }); return texto; });
afterEach(() => { setAudioTools(null); seen.length = 0; });

describe("ditado do 'Sobre o quê?' (Cati 16/10): o mesmo transcritor dos áudios do WhatsApp", () => {
  it("transcreve só os 2 primeiros minutos, devolve o texto limpo e apaga o arquivo temporário", async () => {
    setAudioTools(ouve("  diz pra ela que   abriu horário sábado \n"));
    expect(await transcreverDitado(new TextEncoder().encode("audio-falso"), "audio/webm;codecs=opus")).toBe("diz pra ela que abriu horário sábado");
    expect(seen[0]).toMatchObject({ bytes: "audio-falso", maxSeconds: DITADO_MAX_SECONDS, existia: true });
    expect(seen[0].file).toMatch(/\.webm$/);
    expect(existsSync(seen[0].file)).toBe(false);
  });

  it("Safari grava mp4: vira .m4a", async () => {
    setAudioTools(ouve("ok"));
    await transcreverDitado(new Uint8Array([1, 2, 3]), "audio/mp4");
    expect(seen[0].file).toMatch(/\.m4a$/);
  });

  it("erros viram mensagem para a atendente: vazio, grande, formato, sem fala, transcritor ausente ou falhando", async () => {
    setAudioTools(ouve(""));
    await expect(transcreverDitado(new Uint8Array(), "audio/webm")).rejects.toThrow("O áudio veio vazio");
    await expect(transcreverDitado(new Uint8Array(DITADO_MAX_BYTES + 1), "audio/webm")).rejects.toThrow("Áudio longo demais");
    await expect(transcreverDitado(new Uint8Array([1]), "video/mp4")).rejects.toThrow("Formato de áudio não aceito");
    await expect(transcreverDitado(new Uint8Array([1]), "audio/webm")).rejects.toThrow("Não deu para ouvir nada");
    setAudioTools(tools(async () => { throw new AudioToolMissing("python não instalado"); }));
    await expect(transcreverDitado(new Uint8Array([1]), "audio/webm")).rejects.toThrow("não está instalada no servidor");
    setAudioTools(tools(async () => { throw new Error("whisper caiu"); }));
    await expect(transcreverDitado(new Uint8Array([1]), "audio/webm")).rejects.toThrow("Não deu para entender o áudio");
    // A fila não trava depois de uma falha.
    setAudioTools(ouve("de novo"));
    expect(await transcreverDitado(new Uint8Array([1]), "audio/ogg")).toBe("de novo");
  });

  it("um por vez: o segundo ditado espera o primeiro terminar", async () => {
    const ordem: string[] = [];
    let solta!: () => void;
    const trava = new Promise<void>((r) => { solta = r; });
    setAudioTools(tools(async (file) => {
      const n = readFileSync(file, "utf8");
      ordem.push(`começa ${n}`);
      if (n === "1") await trava;
      ordem.push(`termina ${n}`);
      return n;
    }));
    const a = transcreverDitado(new TextEncoder().encode("1"), "audio/webm");
    const b = transcreverDitado(new TextEncoder().encode("2"), "audio/webm");
    await new Promise((r) => setTimeout(r, 30));
    expect(ordem).toEqual(["começa 1"]);
    solta();
    expect(await Promise.all([a, b])).toEqual(["1", "2"]);
    expect(ordem).toEqual(["começa 1", "termina 1", "começa 2", "termina 2"]);
  });
});
