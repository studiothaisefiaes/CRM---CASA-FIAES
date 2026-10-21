import { describe, expect, it } from "vitest";
import { hourLabel, optionsText, proDisplayName, slotDayLabel } from "./slot-text";

describe("nome da profissional nos textos", () => {
  it("apelido em maiúsculas (como vem do Avec) vira nome; o resto fica como a gestão escreveu", () => {
    expect(proDisplayName("MAIARA")).toBe("Maiara");
    expect(proDisplayName("ANA PAULA")).toBe("Ana Paula");
    expect(proDisplayName("  Bia  ")).toBe("Bia");
    expect(proDisplayName("ana")).toBe("ana");
    expect(proDisplayName("")).toBe("Profissional");
  });
});

describe("Copiar opções", () => {
  it("hora e dia como a recepção escreve", () => {
    expect(hourLabel(600)).toBe("10h");
    expect(hourLabel(870)).toBe("14h30");
    expect(slotDayLabel("2026-10-15")).toBe("quinta, 15/10");
    expect(slotDayLabel("2026-11-01")).toBe("domingo, 01/11");
  });
  it("um dia, duas profissionais: o texto para colar na conversa", () => {
    expect(optionsText([{ day: "2026-10-15", start: 870, proName: "Bia" }, { day: "2026-10-15", start: 600, proName: "Ana" }]))
      .toBe("Tenho quinta, 15/10, às 10h com a Ana ou às 14h30 com a Bia");
  });
  it("mesma profissional seguida junta as horas; outro dia vira outra frase", () => {
    expect(optionsText([
      { day: "2026-10-15", start: 600, proName: "Ana" }, { day: "2026-10-15", start: 660, proName: "Ana" }, { day: "2026-10-15", start: 870, proName: "Bia" },
      { day: "2026-10-16", start: 540, proName: "Ana" },
    ])).toBe("Tenho quinta, 15/10, às 10h ou às 11h com a Ana ou às 14h30 com a Bia. Ou sexta, 16/10, às 9h com a Ana");
    expect(optionsText([])).toBe("");
  });
});

