/** Áudio de mais de 10 minutos: a transcrição cobre só o começo (whatsapp/audio.ts, TRANSCRIBE_MAX_SECONDS). */
export const TRANSCRIPT_MAX_SECONDS = 600;

export type TranscriptStatus = "pendente" | "pronta" | "falhou" | "sem_fala";

/** 42 → "0:42"; 75 → "1:15"; 3725 → "1:02:05". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`;
}

/** Prévia na Fila e no Quadro: "Áudio (0:42): começo da transcrição…". Sem duração/transcrição, cai para "Áudio". */
export function audioPreview(durationSec: number | null | undefined, transcript: string | null | undefined, max = 80): string {
  const label = durationSec != null ? `Áudio (${formatDuration(durationSec)})` : "Áudio";
  const t = transcript?.replace(/\s+/g, " ").trim();
  if (!t) return label;
  return `${label}: ${t.length > max ? `${t.slice(0, max).trimEnd()}…` : t}`;
}
