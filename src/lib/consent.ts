/** Consentimento e Automáticas pausadas (Fase B). Funções puras: servem ao servidor, à fila e à tela. */
export type Consent = { whatsapp: boolean | null; ai: boolean | null; cpfNota: boolean | null };
export const CONSENT_KEYS = ["whatsapp", "ai", "cpfNota"] as const;
export type ConsentKey = (typeof CONSENT_KEYS)[number];

export const PAUSED_REASON = "As automáticas desta cliente estão pausadas.";
/** Selo da linha da Fila (`QueueItem.badges`) e da conversa. */
export const PAUSED_BADGE = "Automáticas pausadas";
const OFFSET_MS = 3 * 3_600_000; // America/Bahia, UTC-3, sem horário de verão

/** Amanhã 00:00 em Salvador (a pausa "Até amanhã" vale até a virada do dia). */
export function tomorrowStartBahia(now: Date): Date {
  const local = new Date(now.getTime() - OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1) + OFFSET_MS);
}

/** 'infinity' no banco ("até alguém religar") chega como esta data máxima (ver `PAUSE_FOREVER` no schema). */
const FOREVER_MS = 8_640_000_000_000_000;

/**
 * Lê `automations_paused_until`: "sempre" (até alguém religar), a data em que a pausa acaba, ou null (sem pausa ou já vencida).
 * Também entende o que o driver devolve sem tratamento (Infinity / Invalid Date).
 */
export function pauseOf(raw: Date | number | string | null | undefined, now: Date): "sempre" | Date | null {
  if (raw === null || raw === undefined) return null;
  const t = raw instanceof Date ? raw.getTime() : typeof raw === "number" ? raw : raw === "infinity" ? Infinity : new Date(raw).getTime();
  if (!Number.isFinite(t) || t >= FOREVER_MS) return "sempre";
  return t > now.getTime() ? new Date(t) : null;
}
