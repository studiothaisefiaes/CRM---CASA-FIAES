/**
 * Colisão na conversa (pesquisa 20/10, Help Scout): com 2 a 5 pessoas no mesmo número, a mensagem duplicada nasce quando duas
 * respondem juntas ou quando a cliente escreve de novo enquanto alguém digitava. Módulo puro (servidor e navegador).
 * Nada do texto sai do aparelho: o servidor só repassa "fulana está escrevendo nesta conversa".
 */

/** De quanto em quanto tempo quem digita avisa (no máximo). */
export const TYPING_PING_MS = 3_000;
/** Quanto tempo o "está escrevendo…" fica na tela sem um aviso novo. */
export const TYPING_SHOW_MS = 7_000;

/** Pode avisar de novo? Só com texto no campo e depois do intervalo. */
export const shouldPingTyping = (text: string, lastPingAt: number, now: number): boolean =>
  text.trim().length > 0 && now - lastPingAt >= TYPING_PING_MS;

/** "Sara está escrevendo…", "Sara e Cati estão escrevendo…", "Sara, Cati e Bia estão escrevendo…". Vazio = ninguém. */
export function typingText(names: string[]): string {
  const n = [...new Set(names.map((x) => x.trim()).filter(Boolean))];
  if (!n.length) return "";
  if (n.length === 1) return `${n[0]} está escrevendo…`;
  return `${n.slice(0, -1).join(", ")} e ${n.at(-1)} estão escrevendo…`;
}

/** Quem está escrevendo agora (os avisos ainda válidos), sem quem vê a tela. */
export function typingNow(seen: ReadonlyMap<string, { name: string; at: number }>, me: string | null | undefined, now: number): string[] {
  return [...seen.entries()].filter(([id, v]) => id !== me && now - v.at < TYPING_SHOW_MS).map(([, v]) => v.name);
}

export const NEW_WHILE_TYPING = "Chegou mensagem nova dela. Enviar mesmo assim?";
