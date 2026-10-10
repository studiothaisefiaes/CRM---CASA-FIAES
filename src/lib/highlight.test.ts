import { describe, it, expect } from "vitest";
import { excerptAround, splitHighlight } from "./highlight";

describe("splitHighlight", () => {
  it("separa o trecho encontrado sem diferenciar maiúsculas", () => {
    expect(splitHighlight("Quero fazer PROGRESSIVA amanhã", "progressiva")).toEqual([
      { text: "Quero fazer ", hit: false }, { text: "PROGRESSIVA", hit: true }, { text: " amanhã", hit: false },
    ]);
  });
  it("marca todas as ocorrências", () => {
    expect(splitHighlight("ana e Ana", "ana").filter((p) => p.hit)).toHaveLength(2);
  });
  it("trata o termo como texto, nunca como expressão regular", () => {
    expect(splitHighlight("preço (R$ 50) .* ok", ".*")).toEqual([{ text: "preço (R$ 50) ", hit: false }, { text: ".*", hit: true }, { text: " ok", hit: false }]);
    expect(splitHighlight("abc", "(")).toEqual([{ text: "abc", hit: false }]);
  });
  it("HTML na mensagem fica como texto puro", () => {
    const pieces = splitHighlight("<img src=x onerror=alert(1)> escova", "escova");
    expect(pieces.map((p) => p.text).join("")).toBe("<img src=x onerror=alert(1)> escova");
    expect(pieces.find((p) => p.hit)?.text).toBe("escova");
  });
  it("sem termo ou sem acerto devolve o texto inteiro", () => {
    expect(splitHighlight("oi", "")).toEqual([{ text: "oi", hit: false }]);
    expect(splitHighlight("oi", "xyz")).toEqual([{ text: "oi", hit: false }]);
  });
});

describe("excerptAround", () => {
  it("recorta em volta do acerto e marca as pontas cortadas", () => {
    const body = `${"a ".repeat(80)}progressiva${" b".repeat(80)}`;
    const out = excerptAround(body, "progressiva");
    expect(out).toContain("progressiva");
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(160);
  });
  it("mensagem curta fica inteira, numa linha", () => {
    expect(excerptAround("oi\n tudo bem?", "tudo")).toBe("oi tudo bem?");
  });
});
