import { expect, it } from "vitest";
import { comissaoTabs, pickAba } from "./comissao-tabs";

const ON = { vales: true, pagarComissao: true };
const ALL = ["comissao.ver", "comissao.regras", "comissao.lancar", "comissao.pagar"];

it("as abas na ordem: Resumo · A pagar · Lançamentos · Regras, só as que a permissão deixa", () => {
  expect(comissaoTabs(ALL, ON).map((t) => t.label)).toEqual(["Resumo", "A pagar", "Lançamentos", "Regras"]);
  expect(comissaoTabs(["comissao.ver", "comissao.lancar"], ON).map((t) => t.value)).toEqual(["relatorio", "lancamentos"]);
  expect(comissaoTabs(["comissao.pagar"], ON).map((t) => t.value)).toEqual(["apagar"]);
});

it("'Pagar a comissão' desligado esconde A pagar; 'Vale, bônus e desconto' desligado esconde Lançamentos", () => {
  expect(comissaoTabs(ALL, { ...ON, pagarComissao: false }).map((t) => t.value)).toEqual(["relatorio", "lancamentos", "regras"]);
  expect(comissaoTabs(ALL, { ...ON, vales: false }).map((t) => t.value)).toEqual(["relatorio", "apagar", "regras"]);
});

it("a aba pedida vale só se estiver na lista; senão a primeira", () => {
  const tabs = comissaoTabs(ALL, { ...ON, pagarComissao: false });
  expect(pickAba(tabs, "apagar")).toBe("relatorio");
  expect(pickAba(tabs, "regras")).toBe("regras");
  expect(pickAba(comissaoTabs(["comissao.pagar"], { ...ON, pagarComissao: false }), "apagar")).toBeNull();
});
