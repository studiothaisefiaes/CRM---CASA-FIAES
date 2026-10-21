import { describe, expect, it } from "vitest";
import { isPriceKind, priceText } from "./service-price";

describe("priceText", () => {
  it("priceText", () => {
    expect(priceText(15000, "a_partir_de")).toBe("a partir de R$ 150,00");
    expect(priceText(null, "sob_consulta")).toBe("sob consulta");
  });
  it("fixo e vazio (null) mostram só o valor; sem preço volta null; sob consulta ignora o valor", () => {
    expect(priceText(15000, "fixo")).toBe("R$ 150,00");
    expect(priceText(15000, null)).toBe("R$ 150,00");
    expect(priceText(null, null)).toBeNull();
    expect(priceText(null, "a_partir_de")).toBeNull();
    expect(priceText(15000, "sob_consulta")).toBe("sob consulta");
  });
  it("isPriceKind só aceita os três", () => {
    expect(["fixo", "a_partir_de", "sob_consulta"].every(isPriceKind)).toBe(true);
    expect(isPriceKind("outro")).toBe(false);
    expect(isPriceKind(null)).toBe(false);
  });
});
