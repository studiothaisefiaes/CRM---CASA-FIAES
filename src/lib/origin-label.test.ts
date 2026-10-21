import { expect, it } from "vitest";
import { originLabel, originOptions } from "./origin-label";
import { RETORNO_ORIGIN } from "@/server/domain/suggested-return";

it("a origem gravada pelo Retorno sugerido aparece na tela como Hora de voltar (o valor no banco não muda)", () => {
  expect(originLabel(RETORNO_ORIGIN)).toBe("Hora de voltar");
});

it("as outras origens aparecem como foram gravadas", () => {
  expect(originLabel("Instagram")).toBe("Instagram");
  expect(originLabel(null)).toBeNull();
});

it("opções de filtro por origem: o rótulo é o da tela, o valor é o do banco (filtrar continua achando)", () => {
  expect(originOptions(["Instagram", RETORNO_ORIGIN])).toEqual([{ value: "Instagram", label: "Instagram" }, { value: RETORNO_ORIGIN, label: "Hora de voltar" }]);
});
