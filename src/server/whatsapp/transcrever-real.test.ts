import { it, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs"; import { tmpdir, homedir } from "node:os"; import path from "node:path";
import { defaultAudioTools } from "./audio";

// Teste real e opcional (só na máquina de quem tem tudo): scripts/transcrever.py com faster-whisper num .ogg gerado aqui pela voz
// do macOS (`say`). Nunca áudio de cliente. Python com faster-whisper: WHISPER_PYTHON ou o python3 do sistema; modelo já baixado
// (padrão: medium, do cache ~/.cache/huggingface). Sem isso, pula.
const py = process.env.WHISPER_PYTHON || "python3";
const has = (cmd: string, args: string[]) => { try { return spawnSync(cmd, args, { stdio: "ignore" }).status === 0; } catch { return false; } };
const model = process.env.WHISPER_MODEL || "medium";
const cached = existsSync(path.join(homedir(), ".cache/huggingface/hub", `models--Systran--faster-whisper-${model}`));
const ready = has(py, ["-c", "import faster_whisper"]) && has("ffmpeg", ["-version"]) && has("say", ["-v", "?"]) && cached;

it.skipIf(!ready)("transcreve em português um áudio curto gerado pelo teste", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cf-whisper-"));
  const aiff = path.join(dir, "voz.aiff"), ogg = path.join(dir, "voz.ogg");
  execFileSync("say", ["-v", "Luciana", "-o", aiff, "Bom dia, eu queria marcar uma escova para sábado de manhã."]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", aiff, "-c:a", "libopus", "-b:a", "24k", ogg]);
  const prev = { ...process.env };
  process.env.TRANSCRIBE_CMD = `${py} ${path.join(process.cwd(), "scripts", "transcrever.py")}`;
  process.env.WHISPER_MODEL = model;
  try {
    const text = await defaultAudioTools().transcribe(ogg, { maxSeconds: 600 });
    expect(text.toLowerCase()).toMatch(/escova/);
    expect(text.toLowerCase()).toMatch(/sábado/);
  } finally { process.env.TRANSCRIBE_CMD = prev.TRANSCRIBE_CMD; process.env.WHISPER_MODEL = prev.WHISPER_MODEL; if (prev.TRANSCRIBE_CMD === undefined) delete process.env.TRANSCRIBE_CMD; if (prev.WHISPER_MODEL === undefined) delete process.env.WHISPER_MODEL; }
}, 300_000);
