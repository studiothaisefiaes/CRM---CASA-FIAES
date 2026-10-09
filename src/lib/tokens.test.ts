import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const token = (n: string) => css.match(new RegExp(`--color-${n}:\\s*(#[0-9a-fA-F]{6})`))![1];
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe("contraste dos tokens (WCAG)", () => {
  it("borda de campo (control) tem ≥ 3:1 sobre o papel", () => expect(ratio(token("control"), token("paper"))).toBeGreaterThanOrEqual(3));
  it("texto dourado pequeno (gold-ink) tem ≥ 4,5:1 sobre o papel", () => expect(ratio(token("gold-ink"), token("paper"))).toBeGreaterThanOrEqual(4.5));
  it("texto de apoio (muted) tem ≥ 4,5:1 sobre o papel", () => expect(ratio(token("muted"), token("paper"))).toBeGreaterThanOrEqual(4.5));
});
