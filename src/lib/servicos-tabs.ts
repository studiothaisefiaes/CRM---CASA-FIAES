import { can, type Perm } from "./permissions";

/** As abas de Serviços e pacotes (/servicos). */
export type ServicosTab = "servicos" | "pacotes" | "formas" | "fidelidade" | "produtos";

/** Quem entra em Serviços e pacotes: quem atende (consulta), quem muda serviços e quem cuida do estoque (só a aba Produtos). */
export const SERVICOS_PERMS: Perm[] = ["atendimento.ver", "servicos.editar", "estoque.produtos", "estoque.movimentar"];

/**
 * A aba que a pessoa vê (M-5). Perfil só com estoque (sem atendimento.ver nem servicos.editar) vê só Produtos, com Produtos e estoque
 * ligado; desligado, não tem o que ver (null). Os outros seguem as regras de antes: Produtos só ligado, Clientes com atendimento.ver,
 * Formas com caixa.gerir.
 */
export function servicosView(perms: readonly string[], o: { aba: unknown; estoqueOn: boolean }): { tab: ServicosTab; soProdutos: boolean } | null {
  const canClients = can(perms, "atendimento.ver");
  const canServicos = canClients || can(perms, "servicos.editar");
  const produtosOn = o.estoqueOn && (canClients || can(perms, "estoque.produtos") || can(perms, "estoque.movimentar"));
  if (!canServicos) return produtosOn ? { tab: "produtos", soProdutos: true } : null;
  const tab: ServicosTab = o.aba === "produtos" && produtosOn ? "produtos" : o.aba === "pacotes" ? "pacotes" : o.aba === "formas" && can(perms, "caixa.gerir") ? "formas" : o.aba === "fidelidade" ? "fidelidade" : "servicos";
  return { tab, soProdutos: false };
}
