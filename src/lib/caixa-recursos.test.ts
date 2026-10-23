import { expect, it } from "vitest";
import { CAIXA_RECURSOS_PADRAO, RECIBO_TEXTO_SUGERIDO, RECURSO_KEYS, RECURSO_LABEL, fillRecibo, readCaixaRecursos, recursoOffMessage } from "./caixa-recursos";

it("campo ausente ou inválido volta ao padrão; o que é válido é mantido", () => {
  expect(readCaixaRecursos({ taxaCartao: false, assistentesMax: 21, reciboTexto: "  " })).toEqual({ ...CAIXA_RECURSOS_PADRAO, taxaCartao: false, assistentesMax: 20, reciboTexto: RECIBO_TEXTO_SUGERIDO });
  expect(readCaixaRecursos(undefined)).toEqual(CAIXA_RECURSOS_PADRAO);
  expect(readCaixaRecursos({ assistentesMax: 1, valeSenhaTentativas: 7, valeSenhaJanelaMin: 30, reciboTexto: "Oi" })).toMatchObject({ assistentesMax: 1, valeSenhaTentativas: 7, valeSenhaJanelaMin: 30, reciboTexto: "Oi" });
  expect(readCaixaRecursos({ valeSenhaTentativas: 21, valeSenhaJanelaMin: 0 })).toMatchObject({ valeSenhaTentativas: 5, valeSenhaJanelaMin: 10 });
});
it("o padrão liga tudo", () => { expect(RECURSO_KEYS.every((k) => CAIXA_RECURSOS_PADRAO[k] === true)).toBe(true); });
it("fillRecibo troca as variáveis conhecidas e deixa as outras", () => {
  expect(fillRecibo("Oi {profissional}, {x}", { profissional: "Ana" })).toBe("Oi Ana, {x}");
});
it("mensagem de recurso desligado", () => { expect(recursoOffMessage("vales")).toBe(`${RECURSO_LABEL.vales} está desligado em Configurações › Caixa.`); });
it("'Pagar comissão a partir de': data válida fica, o resto vira sem corte", () => {
  expect(CAIXA_RECURSOS_PADRAO.pagarComissaoDesde).toBeNull();
  expect(readCaixaRecursos({ pagarComissaoDesde: "2026-09-15" }).pagarComissaoDesde).toBe("2026-09-15");
  expect(readCaixaRecursos({ pagarComissaoDesde: "15/09/2026" }).pagarComissaoDesde).toBeNull();
  expect(readCaixaRecursos({ pagarComissaoDesde: "2026-13-01" }).pagarComissaoDesde).toBeNull();
});
it("assistentes por serviço: de 1 a 20, padrão 20 (22/10: quantas o dono quiser)", () => {
  expect(CAIXA_RECURSOS_PADRAO.assistentesMax).toBe(20);
  expect(readCaixaRecursos({ assistentesMax: 7 }).assistentesMax).toBe(7);
  expect([0, 21, 2.5, "3"].map((v) => readCaixaRecursos({ assistentesMax: v }).assistentesMax)).toEqual([20, 20, 20, 20]);
});
