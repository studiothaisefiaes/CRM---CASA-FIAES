import { formatBRL } from "./money";
/**
 * Aba Serviços: como mostrar (módulo puro). Os nomes que vieram do Avec em MAIÚSCULAS aparecem como frase; o banco guarda o que veio.
 */
const unaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const searchKey = (s: string | null | undefined) => unaccent(String(s ?? "")).toLowerCase().replace(/\s+/g, " ").trim();

/** Palavras que o Avec traz sem acento. */
const ACCENTS: Record<string, string> = { metodo: "método", quimica: "química", protese: "prótese", finalizacao: "finalização", manutencao: "manutenção", estetica: "estética", coloracao: "coloração" };
const isShouting = (s: string) => /\p{L}/u.test(s) && s === s.toUpperCase();
const sentence = (s: string) => {
  const words = s.toLowerCase().split(" ").map((w) => ACCENTS[w] ?? w);
  const out = words.join(" ");
  return out.charAt(0).toUpperCase() + out.slice(1);
};

export const UNCATEGORIZED = "Sem categoria";
export function prettyCategory(c: string | null | undefined): string {
  const v = (c ?? "").trim().replace(/\s+/g, " ");
  if (!v) return UNCATEGORIZED;
  if (!isShouting(v)) return v;
  const s = sentence(v);
  return /^m[ée]todo fiaes/i.test(s) ? s.replace(/^m[ée]todo fiaes/i, "Método Fiaes®") : s;
}
export function prettyName(label: string): string {
  const v = label.trim().replace(/\s+/g, " ");
  return isShouting(v) ? sentence(v) : v;
}

export function durationText(min: number | null | undefined): string {
  if (!min) return "Sem duração";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

type Groupable = { label: string; category: string | null; active: boolean; description?: string | null };
export type ServiceGroup<T> = { label: string; items: T[] };
const isFiaes = (k: string) => searchKey(k).startsWith("metodo fiaes");

/** Por categoria: Método Fiaes primeiro (o serviço da Casa), depois por nome, "Sem categoria" no fim. Busca sem acento em nome, categoria e descrição. */
export function groupServices<T extends Groupable>(items: T[], query: string, showInactive: boolean): ServiceGroup<T>[] {
  const words = searchKey(query).split(" ").filter(Boolean);
  const groups = new Map<string, T[]>();
  for (const s of items) {
    if (!s.active && !showInactive) continue;
    const cat = prettyCategory(s.category);
    const hay = searchKey(`${s.label} ${cat} ${s.category ?? ""} ${s.description ?? ""}`);
    if (!words.every((w) => hay.includes(w))) continue;
    groups.set(cat, [...(groups.get(cat) ?? []), s]);
  }
  const rank = (k: string) => (isFiaes(k) ? 0 : k === UNCATEGORIZED ? 2 : 1);
  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0], "pt-BR"))
    .map(([label, list]) => ({ label, items: list.sort((a, b) => Number(b.active) - Number(a.active) || prettyName(a.label).localeCompare(prettyName(b.label), "pt-BR")) }));
}

/** Pacotes: "4 sessões", "1 sessão". */
export const sessionsText = (n: number) => `${n} ${n === 1 ? "sessão" : "sessões"}`;
/** Validade do pacote em dias: "Vale 1 ano", "Vale 90 dias", "Sem validade". */
export function packageValidityText(days: number | null | undefined): string {
  if (!days) return "Sem validade";
  return days % 365 === 0 ? `Vale ${days / 365} ${days === 365 ? "ano" : "anos"}` : `Vale ${days} dias`;
}
/** "Combo Manutenção Método Fiaes · 4 sessões · R$ 8.000,00" ("Também em pacote" no serviço). */
export const packageLine = (p: { name: string; sessions: number; priceCents: number | null }) => `${p.name} · ${sessionsText(p.sessions)}${p.priceCents != null ? ` · ${formatBRL(p.priceCents)}` : ""}`;
