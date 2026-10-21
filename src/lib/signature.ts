// src/lib/signature.ts
/**
 * Assinatura da equipe no começo da mensagem do WhatsApp: "*SARA - CASA FIAES:*" e o texto na linha de baixo (padrão do ChatGuru).
 * Módulo puro: o servidor usa para saber quem respondeu pelo celular; a tela, para tirar a assinatura do balão e da prévia.
 */
const SIGNATURE_RE = /^\s*\*\s*(\p{L}[\p{L} ]{0,29}?)\s*[-–]\s*CASA\s+FIAES\s*:\s*\*[ \t]*(?:\r?\n)?/iu;
const VALID = /^\p{Lu}[\p{Lu} ]{1,29}$/u;

/** "  sara  lima " → "SARA LIMA". */
export function normalizeSignature(raw: string): string {
  return raw.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

/** Chave de comparação, sem acento: "JOSÉ" e "JOSE" são a mesma pessoa. */
export function signatureKey(raw: string): string {
  return normalizeSignature(raw).normalize("NFD").replace(/\p{M}/gu, "");
}

/** Assinatura aceita no cadastro: só letras e espaço, de 2 a 30. */
export function isValidSignature(raw: string): boolean {
  return VALID.test(normalizeSignature(raw));
}

/** O nome da assinatura no começo da mensagem ("SARA"), ou null. Assinatura no meio do texto (citação, encaminhada) não conta. */
export function parseSignature(body: string | null | undefined): string | null {
  if (!body) return null;
  const m = SIGNATURE_RE.exec(body);
  return m ? normalizeSignature(m[1]) : null;
}

/** O texto sem a assinatura do começo (o balão e a prévia já mostram o nome de quem enviou). */
export function stripSignature(body: string | null | undefined): string {
  if (!body) return "";
  return parseSignature(body) ? body.replace(SIGNATURE_RE, "") : body;
}

/** A linha da assinatura como a cliente vê no WhatsApp: "*SARA - CASA FIAES:*". */
export const signatureLine = (sig: string) => `*${normalizeSignature(sig)} - CASA FIAES:*`;

/** Assinatura padrão de quem não cadastrou: o 1º nome em maiúsculas ("Sara Lima" → "SARA"). Nome que não dá assinatura válida: null. */
export function defaultSignature(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0]?.replace(/[^\p{L}]/gu, "") ?? "";
  const sig = normalizeSignature(first);
  return isValidSignature(sig) ? sig : null;
}

/** Põe a assinatura na primeira linha. Sem assinatura cadastrada, ou se o texto já começa com uma, vai como está. */
export function signBody(signature: string | null | undefined, text: string): string {
  if (!signature?.trim() || parseSignature(text)) return text;
  return `${signatureLine(signature)}\n${text}`;
}

/** "MARIA JOSÉ" → "Maria José": é o nome que a equipe usa entre si ("Cati"), e o que aparece quando a assinatura não é de ninguém cadastrado. */
export const signatureDisplayName = (sig: string | null | undefined): string | null =>
  sig ? sig.toLocaleLowerCase("pt-BR").replace(/(^|\s)\p{L}/gu, (c) => c.toLocaleUpperCase("pt-BR")) : null;
