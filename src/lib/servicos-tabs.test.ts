import { describe, expect, it } from "vitest";
import { SERVICOS_PERMS, servicosView } from "./servicos-tabs";

describe("Serviços e pacotes: quem entra e que aba vê (M-5)", () => {
  it("a página aceita quem só mexe no estoque (estoque.produtos ou estoque.movimentar)", () => {
    expect(SERVICOS_PERMS).toEqual(["atendimento.ver", "servicos.editar", "estoque.produtos", "estoque.movimentar"]);
  });
  it("perfil só com estoque: só a aba Produtos (com Produtos e estoque ligado); desligado, nada", () => {
    for (const perms of [["estoque.produtos"], ["estoque.movimentar"]]) {
      expect(servicosView(perms, { aba: undefined, estoqueOn: true })).toEqual({ tab: "produtos", soProdutos: true });
      expect(servicosView(perms, { aba: "pacotes", estoqueOn: true })).toEqual({ tab: "produtos", soProdutos: true });
      expect(servicosView(perms, { aba: "produtos", estoqueOn: false })).toBeNull();
    }
  });
  it("quem vê serviços continua igual: Serviços por padrão, Produtos só ligado, Formas só com caixa.gerir, Clientes só com atendimento.ver", () => {
    expect(servicosView(["atendimento.ver"], { aba: undefined, estoqueOn: true })).toEqual({ tab: "servicos", soProdutos: false });
    expect(servicosView(["atendimento.ver"], { aba: "produtos", estoqueOn: true })).toEqual({ tab: "produtos", soProdutos: false });
    expect(servicosView(["atendimento.ver"], { aba: "produtos", estoqueOn: false })).toEqual({ tab: "servicos", soProdutos: false });
    expect(servicosView(["atendimento.ver"], { aba: "formas", estoqueOn: true })).toEqual({ tab: "servicos", soProdutos: false });
    expect(servicosView(["atendimento.ver", "caixa.gerir"], { aba: "formas", estoqueOn: true })).toEqual({ tab: "formas", soProdutos: false });
    expect(servicosView(["servicos.editar"], { aba: "clientes", estoqueOn: true })).toEqual({ tab: "servicos", soProdutos: false });
    expect(servicosView(["servicos.editar", "atendimento.ver"], { aba: "clientes", estoqueOn: true })).toEqual({ tab: "servicos", soProdutos: false });
    expect(servicosView(["servicos.editar"], { aba: "pacotes", estoqueOn: true })).toEqual({ tab: "pacotes", soProdutos: false });
  });
  it("sem nenhuma das quatro: null", () => {
    expect(servicosView(["caixa.operar"], { aba: undefined, estoqueOn: true })).toBeNull();
  });
});
