import { describe, expect, it } from "vitest";
import { groupNames, nameTokens, samePerson } from "./same-person";

describe("samePerson (várias pessoas no mesmo número)", () => {
  it.each([
    ["Marina Esteves Rezende", "Úrsula Duarte Neves"], ["Tânia De Xavier Salgado", "Lia"], ["Juliana", "Gisele Werneck"], ["Linda Cristiane", "CRISTIANE ATUALIZAR"],
    ["JACKELINE ANDRADE", "jaqueline modelo"], ["CARLA BARROS VIDAL", "CLARA"], ["Carla Zanetti Jardim Campos", "NANCI MAIA"], ["HELENA DUARTE", "WANDA HELENA OTERO DUARTE"],
    ["Lara Freitas", "LARA LACERDA DE DUARTE VIDAL"], ["Cris", "INGRID WERNECK"], ["Lu", "Luciana Souza"], ["Marineide Araújo", "Neide"], ["Isa Alves", "Adalgisa Maria Alves"],
    ["VERA XAVIER", "AIR SOUZA"], ["Anime Wilberger", "amine"], ["Carla Teles", "Bia Aragão"], ["úrsula freitas", "Gabriela Coutinho"], ["Jacineide", "Jacy"],
    ["Ana Carolina Andrade", "RENATA XAVIER DUARTE"], ["FABIANA XAVIER (PITY)", "PITTY"], ["Carla Igarashi Campos", "Malu"], ["Dra. Paula", "Paula Souza"],
  ])("%s = %s", (a, b) => expect(samePerson(a, b)).toBe(true));

  it.each([
    ["Wanda Rezende", "Helena Rezende"], ["Kelly Zanetti Zanetti", "BIANCA ZANETTI"], ["MARINA KLEIN", "SIMONE"], ["MARINA IGARASHI", "CARLA IGARASHI"],
    ["Carla Werneck Henriques", "Carla Ingrid Rosa"], ["PATRÍCIA ESTEVES XAVIER ( otero de Esteves )", "Esteves Esteves"], ["HELENA XAVIER (MÃE DE ALINE)", "RENATA REZENDE"],
    ["INGRID XAVIER", "WANDA CARLA SALGADO MOURA"], ["Wanda Henriques", "ANA BORJA"],
  ])("%s ≠ %s", (a, b) => expect(samePerson(a, b)).toBe(false));

  it("nome vazio nunca separa; tokens sem acento, sem parêntese e sem 'de'", () => {
    expect(samePerson("", "Bruna")).toBe(true);
    expect(nameTokens("Dra. Carla da Quintela (mãe)")).toEqual(["maria", "conceicao"]);
  });

  it("groupNames junta por transitividade e mantém a ordem", () => {
    expect(groupNames([{ name: "Gabi" }, { name: "Marta" }, { name: "Gabriela Souza" }]).map((g) => g.map((x) => x.name))).toEqual([["Gabi", "Gabriela Souza"], ["Marta"]]);
  });
});
