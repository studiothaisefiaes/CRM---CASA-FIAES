import { can, canSeeAvecReports, canSeeSalon } from "./permissions";

/** Uma visão dentro de uma tela (pedido do dono, 18/10: o menu lateral não tem subtópicos; a troca de visões mora na tela). */
export type SectionTab = { key: string; label: string; href: string };

/** Hoje: Resumo · Recepção · Ao vivo. Sem atendimento.ver a tela é só o aviso (sem abas). */
export function hojeTabs(perms: readonly string[]): SectionTab[] {
  if (!can(perms, "atendimento.ver")) return [];
  return [{ key: "resumo", label: "Resumo", href: "/" }, { key: "recepcao", label: "Recepção", href: "/?vista=recepcao" }, { key: "ao-vivo", label: "Ao vivo", href: "/ao-vivo" }];
}

/**
 * Caixa: Comandas (o próprio Caixa) · Fechar o dia · Fechamentos · Caixas da equipe · Pacotes das clientes. A receber e Fechamentos só com o
 * caixa no CRM; Caixas da equipe pede caixa.outros; Pacotes, config.sistema ou caixa.gerir. (A Comissão é de Relatórios.)
 */
export function caixaTabs(perms: readonly string[], o: { caixaOn: boolean }): SectionTab[] {
  if (!can(perms, "caixa.operar")) return [];
  return [
    ...(o.caixaOn ? [{ key: "caixa", label: "Comandas", href: "/caixa" }] : []),
    { key: "fechar-dia", label: "Fechar o dia", href: "/caixa/fechar-dia" },
    ...(o.caixaOn ? [{ key: "fechamentos", label: "Fechamentos", href: "/caixa/fechamentos" }] : []),
    ...(o.caixaOn && can(perms, "caixa.outros") ? [{ key: "equipe", label: "Caixas da equipe", href: "/caixa/equipe" }] : []),
    ...(can(perms, "config.sistema") || can(perms, "caixa.gerir") ? [{ key: "pacotes", label: "Pacotes das clientes", href: "/caixa/pacotes" }] : []),
  ];
}

/** Clientes: Clientes · Com pacote (atendimento.ver) · Fidelidade (com a função ligada). */
export function clientesTabs(perms: readonly string[], o: { fidelidadeOn: boolean }): SectionTab[] {
  if (!can(perms, "contatos.ver")) return [];
  return [
    { key: "clientes", label: "Clientes", href: "/contatos" },
    ...(can(perms, "atendimento.ver") ? [{ key: "pacote", label: "Com pacote", href: "/contatos?vista=pacote" }] : []),
    ...(o.fidelidadeOn ? [{ key: "fidelidade", label: "Fidelidade", href: "/contatos?vista=fidelidade" }] : []),
  ];
}

/** Relatórios: as visões da tela, cada uma só para quem pode. Comissão e Jornada seguem nas rotas delas, com a aba acesa. */
export function relatoriosTabs(perms: readonly string[]): SectionTab[] {
  if (!can(perms, "relatorios.ver")) return [];
  return [
    { key: "visao", label: "Visão geral", href: "/relatorios" },
    ...(canSeeSalon(perms) ? [{ key: "salao", label: "Salão", href: "/relatorios?aba=salao" }] : []),
    { key: "analise", label: "Análise", href: "/relatorios?aba=analise" },
    ...(can(perms, "valores.ver") ? [{ key: "financeiro", label: "Financeiro", href: "/relatorios?aba=financeiro" }] : []),
    ...(["comissao.ver", "comissao.regras", "comissao.lancar", "comissao.pagar", "config.sistema"].some((p) => can(perms, p as never)) ? [{ key: "comissao", label: "Comissão", href: "/caixa/comissao" }] : []),
    ...(can(perms, "jornada.ver") ? [{ key: "jornada", label: "Jornada", href: "/jornada" }] : []),
    ...(canSeeAvecReports(perms) ? [{ key: "avec", label: "Relatórios do Avec", href: "/relatorios/avec" }] : []),
  ];
}
