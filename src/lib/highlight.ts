/**
 * Destaque do trecho encontrado na busca. Puro e sem HTML: devolve pedaços de texto e quem renderiza usa `<mark>`,
 * então o conteúdo de uma mensagem (que é texto de terceiros) nunca vira marcação.
 */
export type Piece = { text: string; hit: boolean };

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Divide `text` nos trechos que casam com `term` (sem diferenciar maiúsculas). Sem termo ou sem acerto, um pedaço só. */
export function splitHighlight(text: string, term: string | null | undefined): Piece[] {
  const t = term?.trim();
  if (!t || !text) return [{ text, hit: false }];
  const out: Piece[] = [];
  let last = 0;
  for (const m of text.matchAll(new RegExp(escapeRe(t), "gi"))) {
    const at = m.index ?? 0;
    if (!m[0]) continue;
    if (at > last) out.push({ text: text.slice(last, at), hit: false });
    out.push({ text: m[0], hit: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

/** Um recorte da mensagem em volta do primeiro acerto, com reticências nas pontas cortadas (uma linha só, para caber no cartão). */
export function excerptAround(body: string, term: string | null | undefined, radius = 56): string {
  const flat = body.replace(/\s+/g, " ").trim();
  const t = term?.trim();
  const at = t ? flat.toLowerCase().indexOf(t.toLowerCase()) : -1;
  if (at < 0 || flat.length <= radius * 2 + (t?.length ?? 0)) return flat.length > radius * 3 ? `${flat.slice(0, radius * 3).trimEnd()}…` : flat;
  const from = Math.max(0, at - radius), to = Math.min(flat.length, at + (t?.length ?? 0) + radius);
  return `${from > 0 ? "…" : ""}${flat.slice(from, to).trim()}${to < flat.length ? "…" : ""}`;
}
