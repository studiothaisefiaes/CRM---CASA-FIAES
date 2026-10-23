import { describe, expect, it } from "vitest";
import { displayName } from "./display-name";

describe("displayName (só para mostrar; o banco não muda)", () => {
  it("nome todo em MAIÚSCULAS vira Título", () => {
    expect(displayName("CARLA HENRIQUES")).toBe("Carla Henriques");
    expect(displayName("ÉRICA ÁVILA")).toBe("Érica Ávila");
  });
  it("partículas ficam minúsculas, menos no começo", () => {
    expect(displayName("CARLA GOMES DOS HENRIQUES")).toBe("Carla Gomes dos Henriques");
    expect(displayName("MARIA DA SILVA E SOUZA")).toBe("Maria da Silva e Souza");
    expect(displayName("DA SILVA MARIA")).toBe("Da Silva Maria");
    expect(displayName("ANA DE OLIVEIRA DAS DORES DO CARMO")).toBe("Ana de Oliveira das Dores do Carmo");
  });
  it("hífen e apóstrofo: cada parte com a inicial", () => {
    expect(displayName("ANA-MARIA D'ÁVILA")).toBe("Ana-Maria d'Ávila");
  });
  it("espaços repetidos não viram buraco", () => {
    expect(displayName("  JOANA   LIMA ")).toBe("Joana Lima");
  });
  it("misturado ou já em minúsculas: fica como veio", () => {
    expect(displayName("Úrsula Freitas")).toBe("Úrsula Freitas");
    expect(displayName("marília")).toBe("marília");
    expect(displayName("Ana LIMA")).toBe("Ana LIMA");
  });
  it("sem letras (telefone) ou sigla de uma letra só: fica como veio", () => {
    expect(displayName("+55 71 99999-0000")).toBe("+55 71 99999-0000");
    expect(displayName("")).toBe("");
  });
});
