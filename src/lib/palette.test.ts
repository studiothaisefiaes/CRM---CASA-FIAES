import { describe, expect, it } from "vitest";
import { PALETTE, contrastRatio, isPaletteKey, paletteHex, textOn } from "./palette";

// Papel e tinta da tela (src/app/globals.css): a cor da profissional aparece sobre os dois.
const PAPER = "#fdfdfc", INK = "#121212";

describe("paleta das profissionais", () => {
  it("12 cores, com chave e nome únicos", () => {
    expect(PALETTE).toHaveLength(12);
    expect(new Set(PALETTE.map((c) => c.key)).size).toBe(12);
    expect(new Set(PALETTE.map((c) => c.label)).size).toBe(12);
    expect(new Set(PALETTE.map((c) => c.hex)).size).toBe(12);
  });
  it("cada cor aparece no claro e no escuro: pelo menos 3:1 contra o papel e contra a tinta", () => {
    for (const c of PALETTE) {
      expect(contrastRatio(c.hex, PAPER), c.key).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.hex, INK), c.key).toBeGreaterThanOrEqual(3);
    }
  });
  it("o texto escrito sobre a cor (tinta ou branco) tem pelo menos 4,5:1", () => {
    for (const c of PALETTE) expect(contrastRatio(textOn(c.hex), c.hex), c.key).toBeGreaterThanOrEqual(4.5);
    expect(textOn("#ffffff")).toBe("#121212");
    expect(textOn("#121212")).toBe("#ffffff");
  });
  it("só as chaves da paleta valem", () => {
    expect(isPaletteKey("ameixa")).toBe(true);
    expect(isPaletteKey("#ff0000")).toBe(false);
    expect(isPaletteKey(null)).toBe(false);
    expect(paletteHex("ameixa")).toMatch(/^#[0-9a-f]{6}$/);
    expect(paletteHex("roxo-neon")).toBeNull();
    expect(paletteHex(null)).toBeNull();
  });
});
