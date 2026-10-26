import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compressVideo, ffmpegCompressor, findFfmpeg, MAX_RAW_VIDEO_BYTES, setVideoCompressor, shrinkVideo } from "./video";

/** "MP4" mínimo (o tipo vem dos bytes: ftyp sem hdlr de som = vídeo). */
const mp4 = (size: number) => Buffer.concat([Buffer.from("\0\0\0\x18ftypisom\0\0\0\0isom"), Buffer.alloc(Math.max(0, size - 20))]);
afterEach(() => { setVideoCompressor(null); vi.restoreAllMocks(); });

describe("compressão de vídeo (resposta pronta e Biblioteca)", () => {
  it("fica com o comprimido quando ele é menor", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(100)); });
    const r = await compressVideo(mp4(5000));
    expect(r).toMatchObject({ compressed: true });
    expect(r.data.length).toBe(100);
  });

  it("comprimido maior ou igual: guarda o original", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(6000)); });
    const orig = mp4(5000);
    const r = await compressVideo(orig);
    expect(r.compressed).toBe(false);
    expect(r.data).toBe(orig);
  });

  it("ffmpeg falhando ou ausente nunca bloqueia: guarda o original e registra no log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setVideoCompressor(async () => { throw new Error("ffmpeg não instalado"); });
    const orig = mp4(5000);
    expect(await compressVideo(orig)).toEqual({ data: orig, compressed: false });
    expect(log.mock.calls.flat().join(" ")).toMatch(/vídeo.*ffmpeg não instalado/);
  });

  it("saída que não é vídeo (arquivo estragado) não substitui o original", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setVideoCompressor(async (_in, out) => { await writeFile(out, Buffer.from("<html>")); });
    const orig = mp4(5000);
    expect((await compressVideo(orig)).data).toBe(orig);
  });

  it("o ffmpeg recebe o vídeo original e grava um .mp4", async () => {
    let seen: { input: Buffer; output: string } | null = null;
    setVideoCompressor(async (input, output) => { seen = { input: readFileSync(input), output }; await writeFile(output, mp4(50)); });
    const orig = mp4(5000);
    await compressVideo(orig);
    expect(seen!.input.equals(orig)).toBe(true);
    expect(seen!.output).toMatch(/\.mp4$/);
  });
});

describe("limites: vídeo bruto até 64 MB, guardado até o limite depois de comprimir", () => {
  it("bruto acima de 64 MB é recusado antes de comprimir", async () => {
    const run = vi.fn();
    setVideoCompressor(run);
    await expect(shrinkVideo(mp4(MAX_RAW_VIDEO_BYTES + 1), 16 * 1024 * 1024)).rejects.toThrow("O vídeo passa de 64 MB. Corte um pedaço e tente de novo.");
    expect(run).not.toHaveBeenCalled();
  });

  it("bruto de 20 MB que comprime para 3 MB entra", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(3 * 1024 * 1024)); });
    expect((await shrinkVideo(mp4(20 * 1024 * 1024), 16 * 1024 * 1024)).length).toBe(3 * 1024 * 1024);
  });

  it("mesmo comprimido passou do limite: mensagem clara", async () => {
    setVideoCompressor(async (_in, out) => { await writeFile(out, mp4(17 * 1024 * 1024)); });
    await expect(shrinkVideo(mp4(30 * 1024 * 1024), 16 * 1024 * 1024)).rejects.toThrow("Mesmo comprimido o vídeo passou de 16 MB. Corte um pedaço e tente de novo.");
  });

  it("não deu para comprimir (ffmpeg falhou) e passou do limite: não diz \"mesmo comprimido\"", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setVideoCompressor(async () => { throw new Error("ffmpeg não instalado"); });
    await expect(shrinkVideo(mp4(20 * 1024 * 1024), 16 * 1024 * 1024)).rejects.toThrow("Não deu para comprimir o vídeo agora e ele passa de 16 MB. Tente um vídeo menor ou avise a gestão.");
  });
});

// Teste de verdade com o ffmpeg da máquina (pula onde não houver): o vídeo pesado vira H.264 de até 720p, largura par, AAC e menor.
const FFMPEG = findFfmpeg();
describe.skipIf(!FFMPEG)("ffmpeg de verdade", () => {
  const probe = (file: string) => execFileSync(path.join(path.dirname(FFMPEG!), "ffprobe"), ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", file], { encoding: "utf8" });
  it("1080p pesado → no máximo 720p, H.264 + AAC, menor que o original", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cf-video-"));
    const src = path.join(dir, "bruto.mp4");
    execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "2",
      "-c:v", "libx264", "-crf", "8", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "320k", "-shortest", src]);
    const orig = readFileSync(src);
    const r = await compressVideo(orig, ffmpegCompressor);
    expect(r.compressed).toBe(true);
    expect(r.data.length).toBeLessThan(orig.length);
    const out = path.join(dir, "saida.mp4");
    await writeFile(out, r.data);
    const streams = (JSON.parse(probe(out)) as { streams: { codec_name: string; width?: number; height?: number }[] }).streams;
    const v = streams.find((s) => s.codec_name === "h264")!;
    expect(v.height).toBe(720);
    expect(v.width! % 2).toBe(0);
    expect(streams.some((s) => s.codec_name === "aac")).toBe(true);
  }, 60_000);

  it("altura ímpar menor que 720 não quebra (largura e altura pares)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cf-video-"));
    const src = path.join(dir, "impar.mp4");
    execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=641x361:rate=30", "-t", "1", "-c:v", "libx264", "-crf", "0", "-preset", "ultrafast", "-pix_fmt", "yuv444p", src]);
    const r = await compressVideo(readFileSync(src), ffmpegCompressor);
    expect(r.compressed).toBe(true);
    const out = path.join(dir, "saida.mp4");
    await writeFile(out, r.data);
    const v = (JSON.parse(probe(out)) as { streams: { codec_name: string; width: number; height: number }[] }).streams.find((s) => s.codec_name === "h264")!;
    expect(v.height).toBe(360);
    expect(v.width % 2).toBe(0);
  }, 60_000);

  // Vídeo de iPhone em pé: HEVC 10 bits num .mov, gravado deitado (1920x1080) com a rotação nos metadados e sem áudio.
  // "720p" vale para o lado MENOR: em pé fica 720x1280 (antes saía 406x720, borrado no celular).
  it("iPhone em pé (.mov HEVC 10 bits com rotação, sem áudio) → H.264 yuv420p 720x1280, em pé", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cf-video-"));
    const raw = path.join(dir, "raw.mov"), src = path.join(dir, "iphone.mov");
    execFileSync(FFMPEG!, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "1", "-c:v", "libx265", "-tag:v", "hvc1", "-pix_fmt", "yuv420p10le", "-crf", "12", "-preset", "ultrafast", raw]);
    execFileSync(FFMPEG!, ["-v", "error", "-y", "-display_rotation", "90", "-i", raw, "-c", "copy", src]);
    const r = await compressVideo(readFileSync(src), ffmpegCompressor);
    expect(r.compressed).toBe(true);
    const out = path.join(dir, "saida.mp4");
    await writeFile(out, r.data);
    const streams = (JSON.parse(execFileSync(path.join(path.dirname(FFMPEG!), "ffprobe"), ["-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt", "-of", "json", out], { encoding: "utf8" })) as
      { streams: { codec_name: string; codec_type: string; width: number; height: number; pix_fmt: string }[] }).streams;
    const v = streams.find((s) => s.codec_type === "video")!;
    expect(v).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p", width: 720, height: 1280 });
    expect(streams.some((s) => s.codec_type === "audio")).toBe(false);
  }, 60_000);
});
