/**
 * Ligações do WhatsApp na conversa (Lote 5). Regras puras: o texto da linha, a duração e a prévia da Fila.
 * A duração só existe quando o WhatsApp deu os dois lados (atendeu → terminou) ou o próprio registro trouxe os segundos: nunca inventada.
 */
/** "recebida": terminou sem o "accept" chegar ao CRM (atendida no celular ou não: o aparelho não avisa). Não pinta de vermelho. */
export type CallStatus = "atendida" | "perdida" | "recusada" | "recebida";
export type CallInfo = {
  video: boolean;
  status: CallStatus;
  /** Segundos de conversa; null/ausente = não deu para calcular. */
  durationSecs?: number | null;
  /** Quando foi atendida (evento "accept" da Evolution), ISO. */
  acceptedAt?: string | null;
  /** Quando terminou (evento "terminate"), ISO. */
  endedAt?: string | null;
  /** Registrada à mão pela equipe ("Registrar ligação"): a ligação feita pelo celular não chega pelo WhatsApp. */
  manual?: boolean;
  /** Registro à mão: caixa postal ou ocupado (fica "não atendida"). */
  busy?: boolean;
  /** "Recebida" que a equipe marcou à mão (Foi atendida / Foi perdida): quem, quando e a espera que havia antes (para voltar ao trocar). */
  marked?: CallMark | null;
};
export type CallMark = { by: string; at: string; prevAwaitingSince: string | null };

/** "45 s", "3 min", "1 h 2 min". Sem duração (ou zero): null. */
export function durationLabel(secs: number | null | undefined): string | null {
  if (!secs || secs <= 0) return null;
  if (secs < 60) return `${Math.round(secs)} s`;
  const min = Math.round(secs / 60);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Segundos entre atender e terminar. Falta um dos dois (ou fora de ordem): null. */
export function callDuration(acceptedAt: string | Date | null | undefined, endedAt: string | Date | null | undefined): number | null {
  if (!acceptedAt || !endedAt) return null;
  const s = (new Date(endedAt).getTime() - new Date(acceptedAt).getTime()) / 1000;
  return Number.isFinite(s) && s > 0 ? Math.round(s) : null;
}

const noun = (video: boolean) => (video ? "Ligação de vídeo" : "Ligação");

/** A linha da conversa: "Ligação recebida · atendida · 3 min", "Ligação perdida", "Ligação feita · não atendida". */
export function callLabel(c: CallInfo, direction: "in" | "out"): string {
  const dur = durationLabel(c.durationSecs);
  if (direction === "in") {
    if (c.status === "recebida") return `${noun(c.video)} recebida`;
    if (c.status !== "atendida") return `${noun(c.video)} ${c.status}`;
    return [`${noun(c.video)} recebida`, "atendida", dur].filter(Boolean).join(" · ");
  }
  const outcome = c.status === "atendida" ? "atendida" : c.status === "recusada" ? "recusada" : "não atendida";
  return [`${noun(c.video)} feita`, outcome, c.status === "atendida" ? dur : null].filter(Boolean).join(" · ");
}

/** Curto, para a Fila: "Ligação 3 min", "Ligação atendida", "Ligação perdida". */
export function callShort(c: CallInfo): string {
  const dur = durationLabel(c.durationSecs);
  if (c.status === "atendida") return dur ? `${noun(c.video)} ${dur}` : `${noun(c.video)} atendida`;
  return `${noun(c.video)} ${c.status}`;
}

/**
 * Prévia da Fila: "Ligação 3 min · marcou corte sábado" (com a anotação, se houver). Sem os dados da ligação, o texto gravado.
 * Feita pela Casa: o rótulo inteiro ("Ligação feita · não atendida"), para não parecer uma ligação da cliente.
 */
export function callPreview(c: CallInfo | null | undefined, note: string | null | undefined, fallback?: string | null, direction: "in" | "out" = "in"): string {
  const head = c ? (direction === "out" ? callLabel(c, "out") : callShort(c)) : fallback?.trim() || "Ligação";
  const n = note?.replace(/\s+/g, " ").trim();
  return n ? `${head} · ${n.length > 60 ? `${n.slice(0, 59)}…` : n}` : head;
}
