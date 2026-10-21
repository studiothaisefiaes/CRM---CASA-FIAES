/**
 * Textos do "Procurar horário" (nome da profissional e, no Lote 6A, o "Copiar opções"). Função pura: a tela e o servidor usam igual.
 */

/** O apelido como a cliente lê: "MAIARA" (como vem do Avec) → "Maiara"; o que a gestão escreveu com minúsculas fica como está. */
export function proDisplayName(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (!n) return "Profissional";
  if (n !== n.toUpperCase() || n === n.toLowerCase()) return n;
  return n.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

const pad = (n: number) => String(n).padStart(2, "0");
const WEEKDAY = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** 600 → "10h", 870 → "14h30". */
export const hourLabel = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? pad(min % 60) : ""}`;

/** "2026-10-15" → "quinta, 15/10". */
export const slotDayLabel = (day: string) => `${WEEKDAY[new Date(`${day}T12:00:00Z`).getUTCDay()]}, ${day.slice(8, 10)}/${day.slice(5, 7)}`;

/**
 * O texto do "Copiar opções", para colar na conversa: "Tenho quinta, 15/10, às 10h com a Ana ou às 14h30 com a Bia". Horas seguidas da
 * mesma profissional se juntam ("às 10h ou às 11h com a Ana"); outro dia vira outra frase (". Ou sexta, 16/10, às 9h com a Ana").
 */
export function optionsText(opts: { day: string; start: number; proName: string }[]): string {
  if (!opts.length) return "";
  const sorted = [...opts].sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
  const days: { day: string; groups: { pro: string; times: number[] }[] }[] = [];
  for (const o of sorted) {
    let d = days.at(-1);
    if (!d || d.day !== o.day) { d = { day: o.day, groups: [] }; days.push(d); }
    const g = d.groups.at(-1);
    if (g && g.pro === o.proName) g.times.push(o.start); else d.groups.push({ pro: o.proName, times: [o.start] });
  }
  return `Tenho ${days.map((d) => `${slotDayLabel(d.day)}, ${d.groups.map((g) => `${g.times.map((t) => `às ${hourLabel(t)}`).join(" ou ")} com a ${g.pro}`).join(" ou ")}`).join(". Ou ")}`;
}
