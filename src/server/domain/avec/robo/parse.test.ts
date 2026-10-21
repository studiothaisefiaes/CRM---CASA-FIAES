import { describe, expect, it } from "vitest";
import { AvecLayoutError, buildTable, cellText } from "./parse";

const H = ["Data inicial", "Data final", "Hora inicial", "Hora final", "Profissional", "Titulo", "obs", "Serviço", "Periodo da semana"];

describe("leitura da tabela do Avec", () => {
  it("tira HTML e entidades das células", () => {
    expect(cellText('<span class="x">Ana &amp; Bia</span><br/>ok&nbsp;!')).toBe("Ana & Bia ok !");
    expect(cellText(null)).toBe("");
    expect(cellText(12.5)).toBe("12.5");
  });
  it("monta cabeçalho + linhas", () => {
    const t = buildTable("0159", "bloqueios", H, [["18/10/2026", "18/10/2026", "09:00", "10:00", "ANA", "Almoço", "", "", "Seg"]]);
    expect(t).toHaveLength(2);
    expect(t[1][4]).toBe("ANA");
  });
  it("coluna a mais ou a menos = o Avec mudou a tela", () => {
    expect(() => buildTable("0159", "bloqueios", H, [["a", "b"]])).toThrow(AvecLayoutError);
  });
  it("formato que o CRM não reconhece = erro", () => {
    expect(() => buildTable("0159", "bloqueios", ["Foo", "Bar"], [])).toThrow(/mudaram/);
    expect(() => buildTable("0159", "bloqueios", [], [])).toThrow(AvecLayoutError);
    expect(() => buildTable("0159", "bloqueios", H, "x")).toThrow(/lista de linhas/);
  });
  it("relatório vazio é válido (só cabeçalho)", () => { expect(buildTable("0159", "bloqueios", H, [])).toEqual([H]); });
});
