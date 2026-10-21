/** Retomada: módulo puro (servidor e tela). */

/** {primeiro_nome} vira o 1º nome (ou o apelido) da cliente; sem nome, some com a vírgula junto ("Oi, {primeiro_nome}!" → "Oi!"). */
export function fillFirstName(text: string, name: string | null | undefined): string {
  const n = name?.trim().split(/\s+/)[0];
  const first = n && !/^\+?[\d\s()-]+$/.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : "";
  return first ? text.replace(/\{primeiro_nome\}/g, first) : text.replace(/,?\s*\{primeiro_nome\}/g, "");
}
