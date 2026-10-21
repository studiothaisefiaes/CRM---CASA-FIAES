import { describe, expect, it } from "vitest";
import { groupNames, nameTokens, samePerson } from "./same-person";

describe("samePerson (várias pessoas no mesmo número)", () => {
  it.each([
    ["Marina Otero Otero", "Quênia Otero Neves"], ["Renata De Rezende Vidal", "Lia"], ["Juliana", "Yara Duarte"], ["Linda Cristiane", "CRISTIANE ATUALIZAR"],
    ["JACKELINE ANDRADE", "jaqueline modelo"], ["CARLA SALGADO ZANETTI", "CLARA"], ["Carla Zanetti Uchoa Klein", "NANCI MAIA"], ["DANIELA JARDIM", "ÚRSULA DANIELA OTERO JARDIM"],
    ["Yara Xavier", "INGRID QUINTELA DE HENRIQUES FREITAS"], ["Cris", "QUÊNIA DUARTE"], ["Lu", "Luciana Souza"], ["Marineide Araújo", "Neide"], ["Isa Alves", "Adalgisa Maria Alves"],
    ["ÚRSULA REZENDE", "AIR SOUZA"], ["Anime Wilberger", "amine"], ["Úrsula Quintela", "Bia Aragão"], ["tânia gomes", "Gabriela Coutinho"], ["Jacineide", "Jacy"],
    ["Ana Carolina Andrade", "ELISA LACERDA HENRIQUES"], ["FABIANA REZENDE (PITY)", "PITTY"], ["Carla Quintela Klein", "Malu"], ["Dra. Paula", "Paula Souza"],
  ])("%s = %s", (a, b) => expect(samePerson(a, b)).toBe(true));

  it.each([
    ["Tânia Klein", "Patrícia Klein"], ["Daniela Lacerda Jardim", "HELENA JARDIM"], ["MARINA SALGADO", "SIMONE"], ["CARLA CAMPOS", "YARA CAMPOS"],
    ["Carla Zanetti Henriques", "Carla Quênia Rosa"], ["ELISA OTERO REZENDE ( rezende de Freitas )", "Freitas Quintela"], ["TÂNIA NOGUEIRA (MÃE DE ALINE)", "GISELE REZENDE"],
    ["ZÉLIA XAVIER", "ÚRSULA ÚRSULA WERNECK JARDIM"], ["Úrsula Vidal", "ANA BORJA"],
  ])("%s ≠ %s", (a, b) => expect(samePerson(a, b)).toBe(false));

  it("nome vazio nunca separa; tokens sem acento, sem parêntese e sem 'de'", () => {
    expect(samePerson("", "Bruna")).toBe(true);
    expect(nameTokens("Dra. Carla da Lacerda (mãe)")).toEqual(["maria", "conceicao"]);
  });

  it("groupNames junta por transitividade e mantém a ordem", () => {
    expect(groupNames([{ name: "Gabi" }, { name: "Marta" }, { name: "Gabriela Souza" }]).map((g) => g.map((x) => x.name))).toEqual([["Gabi", "Gabriela Souza"], ["Marta"]]);
  });
});
