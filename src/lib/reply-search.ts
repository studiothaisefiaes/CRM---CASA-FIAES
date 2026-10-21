/** Busca do "/" nas respostas prontas (20/10). Módulo puro (servidor e tela). */
const normReply = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[-_/.]+/g, " ").replace(/\s+/g, " ").trim();
/** As respostas prontas do "/": todas as palavras do que foi digitado aparecem no atalho, na pasta ou no texto. Atalho e pasta primeiro. Até 30. */
export function searchReplies<T extends { label: string; folder?: string | null; body?: string | null }>(list: T[], typed: string, max = 30): T[] {
  const words = normReply(typed).split(" ").filter(Boolean);
  if (!words.length) return list.slice(0, max);
  const head = (q: T) => normReply(`${q.label} ${q.folder ?? ""}`);
  const all = (q: T) => `${head(q)} ${normReply(q.body ?? "")}`;
  const hit = list.filter((q) => { const t = all(q); return words.every((w) => t.includes(w)); });
  const top = (q: T) => (words.every((w) => head(q).includes(w)) ? 0 : 1);
  return hit.map((q, i) => ({ q, i })).sort((a, b) => top(a.q) - top(b.q) || a.i - b.i).map((x) => x.q).slice(0, max);
}
