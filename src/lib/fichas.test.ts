import { describe, expect, it } from "vitest";
import { FICHA_FORMS, FICHA_FORM_LABEL, QUESTION_KINDS, QUESTION_KIND_LABEL, validateAnswer } from "./fichas";

const OPTS = ["Coloração", "Progressiva", "Outro"];

describe("nomes", () => {
  it("as três fichas e os seis tipos de pergunta, com o nome da Casa", () => {
    expect([...FICHA_FORMS]).toEqual(["anamnese", "consultoria", "campos"]);
    expect(FICHA_FORM_LABEL).toEqual({ anamnese: "Anamnese", consultoria: "Consultoria de imagem", campos: "Campos da ficha" });
    expect([...QUESTION_KINDS]).toEqual(["opcao", "caixas", "texto", "texto_longo", "sim_nao", "data"]);
    expect(QUESTION_KINDS.map((k) => QUESTION_KIND_LABEL[k])).toEqual(["Uma opção", "Várias opções", "Texto curto", "Texto longo", "Sim ou não", "Data"]);
  });
});

describe("validateAnswer", () => {
  it("vazio devolve null (apaga a resposta), em qualquer tipo", () => {
    for (const k of QUESTION_KINDS) {
      expect(validateAnswer(k, OPTS, null)).toBeNull();
      expect(validateAnswer(k, OPTS, undefined)).toBeNull();
      expect(validateAnswer(k, OPTS, "   ")).toBeNull();
    }
    expect(validateAnswer("caixas", OPTS, [])).toBeNull();
  });
  it("uma opção: só da lista", () => {
    expect(validateAnswer("opcao", OPTS, "Outro")).toBe("Outro");
    expect(() => validateAnswer("opcao", OPTS, "Henna")).toThrow("Escolha uma das opções da pergunta.");
    expect(() => validateAnswer("opcao", OPTS, ["Outro"])).toThrow();
  });
  it("várias opções: só da lista, sem repetir; texto solto é recusado", () => {
    expect(validateAnswer("caixas", OPTS, ["Outro", "Coloração", "Outro"])).toEqual(["Outro", "Coloração"]);
    expect(() => validateAnswer("caixas", OPTS, ["Coloração", "Henna"])).toThrow("Escolha só opções da pergunta.");
    expect(() => validateAnswer("caixas", OPTS, "Coloração")).toThrow();
  });
  it("texto curto até 500 e texto longo até 4000; apara os espaços", () => {
    expect(validateAnswer("texto", [], "  corrida  ")).toBe("corrida");
    expect(validateAnswer("texto", [], "a".repeat(500))).toHaveLength(500);
    expect(() => validateAnswer("texto", [], "a".repeat(501))).toThrow("Use até 500 caracteres.");
    expect(validateAnswer("texto_longo", [], "a".repeat(4000))).toHaveLength(4000);
    expect(() => validateAnswer("texto_longo", [], "a".repeat(4001))).toThrow("Use até 4000 caracteres.");
    expect(() => validateAnswer("texto", [], 12)).toThrow();
  });
  it("sim ou não: só sim ou nao", () => {
    expect(validateAnswer("sim_nao", [], "sim")).toBe("sim");
    expect(validateAnswer("sim_nao", [], "nao")).toBe("nao");
    expect(() => validateAnswer("sim_nao", [], "talvez")).toThrow("Responda sim ou não.");
  });
  it("data: AAAA-MM-DD que existe", () => {
    expect(validateAnswer("data", [], "2026-10-18")).toBe("2026-10-18");
    expect(() => validateAnswer("data", [], "18/10/2026")).toThrow("Use uma data válida.");
    expect(() => validateAnswer("data", [], "2026-02-30")).toThrow("Use uma data válida.");
  });
});
