import { formatBRL } from "./money";

/**
 * Como o preço do serviço aparece (0084, Fase C item 24): fixo ("R$ 150,00"), "a partir de R$ 150,00" ou "sob consulta" (sem valor).
 * No banco, `lists.price_kind` vazio quer dizer fixo. Puro: serve à tela, ao /agendar e à lista de preços da IA.
 */
export const PRICE_KINDS = ["fixo", "a_partir_de", "sob_consulta"] as const;
export type PriceKind = (typeof PRICE_KINDS)[number];

export const PRICE_KIND_LABEL: Record<PriceKind, string> = { fixo: "Fixo", a_partir_de: "A partir de", sob_consulta: "Sob consulta" };

export const isPriceKind = (x: unknown): x is PriceKind => typeof x === "string" && (PRICE_KINDS as readonly string[]).includes(x);

/** "R$ 150,00", "a partir de R$ 150,00", "sob consulta"; sem preço (e não "sob consulta"): null. */
export function priceText(priceCents: number | null, kind: PriceKind | null): string | null {
  if (kind === "sob_consulta") return "sob consulta";
  if (priceCents == null) return null;
  const v = formatBRL(priceCents);
  return kind === "a_partir_de" ? `a partir de ${v}` : v;
}
