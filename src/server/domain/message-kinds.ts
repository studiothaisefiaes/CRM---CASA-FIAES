/** Tipos de mensagem da cliente que não abrem espera de resposta: figurinha ou reação de "obrigada" só encerra a conversa. */
export const NON_OPENING_KINDS = ["sticker", "reaction"] as const;

/**
 * Palavras de quem só está encerrando ("Obrigada!", "Ok, combinado", "Amém 🙏"). A mensagem inteira precisa ser feita delas:
 * qualquer palavra fora da lista (uma pergunta, um pedido, "aguardo", "sim") e a conversa continua esperando resposta.
 */
const CLOSING_WORDS = new Set([
  "obrigada", "obrigado", "obrigadinha", "obrigadinho", "brigada", "brigado", "obg", "obgd", "obgda", "grata", "grato", "agradeco", "agradecida",
  "muito", "mt", "mto", "muitissimo", "viu", "valeu", "vlw", "ok", "okk", "okay", "blz", "beleza", "certo", "certinho", "ta", "tah", "bom", "combinado",
  "perfeito", "perfeita", "otimo", "otima", "show", "top", "entendi", "ah", "amem", "tmj", "de", "nada", "imagina", "disponha", "e", "ate", "logo", "breve",
  "deus", "abencoe", "querida", "flor", "linda", "lindo", "amor", "maravilha", "maravilhoso", "maravilhosa", "demais", "pra", "voce", "voces", "vc", "vcs",
  // 16/10: "Joia, muito obrigada", "Tudo bem, eu agradeço o retorno", "Confirmado" contavam como espera (Atrasado sem motivo).
  "joia", "joinha", "confirmado", "confirmada", "confirmadissimo", "confirmadissima", "confirmo", "tudo", "bem", "eu", "o", "a", "os", "as",
  "retorno", "pelo", "pela", "pelos", "pelas", "atencao", "carinho", "informacao", "informacoes", "agradeco", "agradecemos",
]);
const EMOJI = /[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}‍️]/gu;

/** Texto que só agradece/confirma, sem pergunta nem conteúdo novo (ou só emoji). */
export function isClosingText(body: string | null | undefined): boolean {
  const raw = body?.trim() ?? "";
  if (!raw || raw.includes("?") || raw.length > 60) return false;
  const hadEmoji = raw.replace(EMOJI, "") !== raw;
  const words = raw.replace(EMOJI, " ").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z\s]/g, " ").replace(/([a-z])\1{2,}/g, "$1").split(/\s+/).filter(Boolean);
  if (!words.length) return hadEmoji;
  return words.length <= 6 && words.every((w) => CLOSING_WORDS.has(w));
}

/** A mensagem só encerra a conversa (não abre espera quando chega logo depois da resposta da Casa). */
export const closesConversation = (kind?: string, body?: string | null) =>
  !!kind && ((NON_OPENING_KINDS as readonly string[]).includes(kind) || (kind === "text" && isClosingText(body)));
