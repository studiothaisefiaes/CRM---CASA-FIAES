import { describe, expect, it } from "vitest";
import { groupNames, nameTokens, samePerson } from "./same-person";

describe("samePerson (várias pessoas no mesmo número)", () => {
  it.each([
    ["Ingrid Otero Abreu", "Vera Otero Neves"], ["Daniela De Rezende Rezende", "Lia"], ["Juliana", "Zélia Igarashi"], ["Linda Cristiane", "CRISTIANE ATUALIZAR"],
    ["JACKELINE ANDRADE", "jaqueline modelo"], ["CARLA SALGADO KLEIN", "CLARA"], ["Carla Jardim Nogueira Freitas", "NANCI MAIA"], ["OLÍVIA ABREU", "ÚRSULA OLÍVIA IGARASHI ABREU"],
    ["Zélia Freitas", "QUÊNIA DUARTE DE HENRIQUES JARDIM"], ["Cris", "ÚRSULA QUINTELA"], ["Lu", "Luciana Souza"], ["Marineide Araújo", "Neide"], ["Isa Alves", "Adalgisa Maria Alves"],
    ["TÂNIA REZENDE", "AIR SOUZA"], ["Anime Wilberger", "amine"], ["Elisa Lacerda", "Bia Aragão"], ["zélia freitas", "Gabriela Coutinho"], ["Jacineide", "Jacy"],
    ["Ana Carolina Andrade", "RENATA ZANETTI HENRIQUES"], ["ALICE REZENDE (PITY)", "PITTY"], ["Carla Pacheco Freitas", "Malu"], ["Dra. Paula", "Paula Souza"],
  ])("%s = %s", (a, b) => expect(samePerson(a, b)).toBe(true));

  it.each([
    ["Daniela Lacerda", "Joana Lacerda"], ["Bianca Henriques Salgado", "CARLA SALGADO"], ["INGRID PACHECO", "SIMONE"], ["CARLA ZANETTI", "RENATA ZANETTI"],
    ["Carla Esteves Henriques", "Carla Úrsula Rosa"], ["FABIANA OTERO REZENDE ( teles de Nogueira )", "Nogueira Rezende"], ["ZÉLIA XAVIER (MÃE DE ALINE)", "WANDA GOMES"],
    ["WANDA JARDIM", "ÚRSULA ELISA UCHOA LACERDA"], ["Úrsula Quintela", "ANA BORJA"],
  ])("%s ≠ %s", (a, b) => expect(samePerson(a, b)).toBe(false));

  it("nome vazio nunca separa; tokens sem acento, sem parêntese e sem 'de'", () => {
    expect(samePerson("", "Bruna")).toBe(true);
    expect(nameTokens("Dra. Carla da Duarte (mãe)")).toEqual(["maria", "conceicao"]);
  });

  it("groupNames junta por transitividade e mantém a ordem", () => {
    expect(groupNames([{ name: "Gabi" }, { name: "Marta" }, { name: "Gabriela Souza" }]).map((g) => g.map((x) => x.name))).toEqual([["Gabi", "Gabriela Souza"], ["Marta"]]);
  });
});
