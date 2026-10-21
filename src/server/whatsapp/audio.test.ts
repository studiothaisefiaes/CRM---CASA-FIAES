import { it, expect, beforeEach, afterEach, describe } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, chmodSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { messages, contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { AudioToolMissing, defaultAudioTools, planOldAudio, processPendingAudio, queueOldAudio, setAudioTools, TRANSCRIBE_MAX_SECONDS, type AudioTools } from "./audio";

const DIR = mkdtempSync(path.join(tmpdir(), "cf-audio-")); process.env.MEDIA_DIR = DIR;
const OGG = Buffer.from("OggS\0\x02fake-opus");

/** Ferramentas falsas: ffmpeg grava um m4a de mentira; a transcrição devolve o que o teste mandar. */
const fakeTools = (over: Partial<AudioTools> & { calls?: { transcribe: { file: string; maxSeconds: number }[] } } = {}): AudioTools & { calls: { transcribe: { file: string; maxSeconds: number }[] } } => {
  const calls = over.calls ?? { transcribe: [] as { file: string; maxSeconds: number }[] };
  return {
    toM4a: async (_i, out) => { writeFileSync(out, Buffer.from("\0\0\0\x20ftypM4A ")); },
    duration: async () => 42,
    transcribe: async (file, o) => { calls.transcribe.push({ file, maxSeconds: o.maxSeconds }); return "Oi, queria marcar escova para sábado"; },
    ...over, calls,
  };
};

let seq = 0;
const audio = async (over: Partial<typeof messages.$inferInsert> = {}) => {
  const [c] = await db.insert(contacts).values({ phoneE164: `+55719999${String(++seq).padStart(5, "0")}` }).returning();
  const name = `a${seq}.ogg`; writeFileSync(path.join(DIR, name), OGG);
  const [m] = await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "audio", mediaPath: name, mediaMime: "audio/ogg", ...over }).returning();
  return m;
};
const row = async (id: string) => (await db.select().from(messages).where(eq(messages.id, id)))[0];

beforeEach(async () => { await resetDb(); });
afterEach(() => setAudioTools(null));

describe("áudio: conversão e transcrição no worker", () => {
  it("converte para m4a, mede a duração e grava a transcrição", async () => {
    const m = await audio();
    setAudioTools(fakeTools());
    const r = await processPendingAudio();
    expect(r).toMatchObject({ tried: 1, transcribed: 1, failed: 0 });
    const a = await row(m.id);
    expect(a.playbackPath).toBe(`${m.id}.m4a`);
    expect(existsSync(path.join(DIR, a.playbackPath!))).toBe(true);
    expect(a.mediaDurationSec).toBe(42);
    expect(a.transcript).toBe("Oi, queria marcar escova para sábado");
    expect(a.transcriptStatus).toBe("pronta");
    // pronta: não volta para a fila
    expect((await processPendingAudio()).tried).toBe(0);
  });

  it("áudio da Casa (saída) também é transcrito", async () => {
    const m = await audio({ direction: "out" });
    setAudioTools(fakeTools());
    await processPendingAudio();
    expect((await row(m.id)).transcriptStatus).toBe("pronta");
  });

  it("sem fala: status sem_fala e sem texto", async () => {
    const m = await audio();
    setAudioTools(fakeTools({ transcribe: async () => "  \n" }));
    await processPendingAudio();
    const a = await row(m.id);
    expect(a.transcriptStatus).toBe("sem_fala");
    expect(a.transcript).toBeNull();
  });

  it("falha marca falhou e tenta de novo no máximo 2 vezes (3 no total), sem travar os outros", async () => {
    const bad = await audio({ createdAt: new Date(Date.now() - 60_000) });
    const good = await audio();
    let n = 0;
    setAudioTools(fakeTools({ transcribe: async (file) => { if (file.includes(bad.id)) { n++; throw new Error("whisper caiu"); } return "ok"; } }));
    const first = await processPendingAudio();
    expect(first).toMatchObject({ tried: 2, transcribed: 1, failed: 1 });
    expect((await row(good.id)).transcriptStatus).toBe("pronta");
    let a = await row(bad.id);
    expect(a.transcriptStatus).toBe("falhou"); expect(a.transcriptAttempts).toBe(1);
    for (let i = 0; i < 5; i++) await processPendingAudio();
    a = await row(bad.id);
    expect(n).toBe(3);
    expect(a.transcriptAttempts).toBe(3);
    expect(a.transcriptStatus).toBe("falhou");
    // a conversão feita na 1ª vez não se repete
    expect(a.playbackPath).toBe(`${bad.id}.m4a`);
  });

  it("áudio de mais de 10 minutos guarda a duração inteira e transcreve só os 10 primeiros", async () => {
    const m = await audio();
    const t = fakeTools({ duration: async () => 900 });
    setAudioTools(t);
    await processPendingAudio();
    expect(t.calls.transcribe[0].maxSeconds).toBe(TRANSCRIBE_MAX_SECONDS);
    expect(TRANSCRIBE_MAX_SECONDS).toBe(600);
    expect((await row(m.id)).mediaDurationSec).toBe(900);
  });

  it("sem ffmpeg e sem o comando de transcrição: não quebra, não gasta tentativa e o original continua", async () => {
    const m = await audio();
    setAudioTools(fakeTools({
      toM4a: async () => { throw new AudioToolMissing("ffmpeg"); },
      duration: async () => { throw new AudioToolMissing("ffprobe"); },
      transcribe: async () => { throw new AudioToolMissing("python3"); },
    }));
    const r = await processPendingAudio();
    expect(r.missing).toBe(true);
    const a = await row(m.id);
    expect(a.playbackPath).toBeNull();
    expect(a.mediaPath).toBe(m.mediaPath);
    expect(a.transcriptStatus).toBeNull();
    expect(a.transcriptAttempts).toBe(0);
  });

  it("passou do tempo da rodada: não pega o próximo (o job do pg-boss não expira no meio)", async () => {
    await audio(); await audio();
    setAudioTools(fakeTools());
    expect((await processPendingAudio(5, { budgetMs: 0 })).tried).toBe(1);
  });

  it("áudio antigo (mais de 3 dias) só entra quando enfileirado; mídia apagada nunca entra", async () => {
    const old = await audio({ createdAt: new Date(Date.now() - 10 * 86_400_000), mediaDurationSec: 30 });
    await audio({ createdAt: new Date(Date.now() - 10 * 86_400_000), mediaPurgedAt: new Date() });
    await audio({ createdAt: new Date(Date.now() - 60 * 86_400_000) });
    setAudioTools(fakeTools());
    expect((await processPendingAudio()).tried).toBe(0);
    const plan = await planOldAudio(30);
    expect(plan.count).toBe(1);
    expect(plan.seconds).toBe(30);
    expect(await queueOldAudio(30)).toBe(1);
    expect((await row(old.id)).transcriptStatus).toBe("pendente");
    expect((await processPendingAudio()).transcribed).toBe(1);
  });

});

describe("ferramentas de verdade (comando configurável)", () => {
  const prev = process.env.TRANSCRIBE_CMD;
  afterEach(() => { if (prev === undefined) delete process.env.TRANSCRIBE_CMD; else process.env.TRANSCRIBE_CMD = prev; });

  it("comando inexistente vira AudioToolMissing", async () => {
    process.env.TRANSCRIBE_CMD = "/nao/existe/transcrever";
    await expect(defaultAudioTools().transcribe(path.join(DIR, "x.ogg"), { maxSeconds: 600 })).rejects.toBeInstanceOf(AudioToolMissing);
  });

  it("imprime o texto na saída; recebe o arquivo e o teto de segundos", async () => {
    const script = path.join(DIR, "fake-transcrever.mjs");
    writeFileSync(script, "process.stdout.write(`texto de ${process.argv[2].split('/').pop()} até ${process.env.TRANSCREVER_MAX_SEGUNDOS}s\\n`)");
    chmodSync(script, 0o755);
    process.env.TRANSCRIBE_CMD = `node ${script}`;
    expect(await defaultAudioTools().transcribe(path.join(DIR, "y.ogg"), { maxSeconds: 600 })).toBe("texto de y.ogg até 600s");
  });

  it("saída 3 do script (faster-whisper não instalado) vira AudioToolMissing; outro erro é falha comum", async () => {
    const s3 = path.join(DIR, "sai3.mjs"); writeFileSync(s3, "process.exit(3)");
    process.env.TRANSCRIBE_CMD = `node ${s3}`;
    await expect(defaultAudioTools().transcribe("z.ogg", { maxSeconds: 600 })).rejects.toBeInstanceOf(AudioToolMissing);
    const s1 = path.join(DIR, "sai1.mjs"); writeFileSync(s1, "process.exit(1)");
    process.env.TRANSCRIBE_CMD = `node ${s1}`;
    const e = await defaultAudioTools().transcribe("z.ogg", { maxSeconds: 600 }).catch((x) => x);
    expect(e).toBeInstanceOf(Error); expect(e).not.toBeInstanceOf(AudioToolMissing);
  });

  it.skipIf(!existsSync("/opt/homebrew/bin/ffmpeg") && !existsSync("/usr/bin/ffmpeg"))("ffmpeg de verdade: ogg opus → m4a tocável e duração", async () => {
    const { execFileSync } = await import("node:child_process");
    const src = path.join(DIR, "tom.ogg");
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-c:a", "libopus", src]);
    const out = path.join(DIR, "tom.m4a");
    await defaultAudioTools().toM4a(src, out);
    expect(readFileSync(out).subarray(4, 8).toString()).toBe("ftyp");
    expect(Math.round((await defaultAudioTools().duration(out))!)).toBe(3);
  });
});
