/**
 * Cores das profissionais na agenda: paleta FECHADA de 12 tons médios, que aparecem sobre o papel (claro) e sobre a tinta (escuro)
 * com pelo menos 3:1, e com texto legível por cima (tinta ou branco, o que der mais contraste). Função pura (tela e servidor).
 */
export const PALETTE = [
  { key: "ameixa", label: "Ameixa", hex: "#8e4a7e" },
  { key: "vinho", label: "Vinho", hex: "#a84a5c" },
  { key: "terracota", label: "Terracota", hex: "#b0563a" },
  { key: "caramelo", label: "Caramelo", hex: "#a0662a" },
  { key: "mostarda", label: "Mostarda", hex: "#9a7a12" },
  { key: "oliva", label: "Oliva", hex: "#6f7a2a" },
  { key: "musgo", label: "Musgo", hex: "#3f7d4f" },
  { key: "petroleo", label: "Petróleo", hex: "#1f7a7a" },
  { key: "oceano", label: "Oceano", hex: "#2f6fa6" },
  { key: "anil", label: "Anil", hex: "#4a5bb5" },
  { key: "lavanda", label: "Lavanda", hex: "#7a5fb5" },
  { key: "rosa", label: "Rosa", hex: "#b8507d" },
] as const;

export type PaletteKey = (typeof PALETTE)[number]["key"];
const BY_KEY = new Map<string, string>(PALETTE.map((c) => [c.key, c.hex]));

export const isPaletteKey = (v: unknown): v is PaletteKey => typeof v === "string" && BY_KEY.has(v);
export const paletteHex = (key: string | null | undefined): string | null => (key ? BY_KEY.get(key) ?? null : null);

const INK = "#121212", WHITE = "#ffffff";
const luminance = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** Contraste WCAG entre duas cores "#rrggbb" (1 a 21). */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** A cor do texto escrito sobre `hex`: tinta ou branco, o que tiver mais contraste. */
export const textOn = (hex: string): typeof INK | typeof WHITE => (contrastRatio(hex, INK) >= contrastRatio(hex, WHITE) ? INK : WHITE);
