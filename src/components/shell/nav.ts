import { IconCalendar, IconChart, IconChat, IconContacts, IconMoney, IconScissors, IconSettings, IconToday } from "@/components/icons";
import { can, canConfigure, isReportsOnly, type Perm } from "@/lib/permissions";

type Icon = typeof IconToday;
export type NavKey = "hoje" | "conversas" | "agenda" | "caixa" | "clientes" | "relatorios" | "servicos" | "config";
/**
 * Item do menu: uma linha, sem subtópicos (pedido do dono, 18/10; a troca de visões mora DENTRO de cada tela). `perm: null` = todos
 * (Configurações usa `canConfigure`, filtrado em `navFor`). `match`: as rotas que acendem o item (padrão: o próprio `href`).
 * `mobile`: na barra de baixo do celular ou dentro do "Mais".
 */
export type NavItem = {
  key: NavKey; href: string; label: string; icon: Icon; perm: Perm | null; group: "dia" | "gestao";
  match?: string[]; mobile: "bar" | "mais";
};

/** Rotas não mudam (Conversas = /atendimento, Clientes = /contatos). Rota mais específica vence: /caixa/comissao é de Relatórios. */
export const NAV: NavItem[] = [
  { key: "hoje", href: "/", label: "Hoje", icon: IconToday, perm: null, group: "dia", mobile: "bar", match: ["/", "/ao-vivo"] },
  { key: "conversas", href: "/atendimento", label: "Conversas", icon: IconChat, perm: "atendimento.ver", group: "dia", mobile: "bar", match: ["/atendimento", "/funil"] },
  { key: "agenda", href: "/agenda", label: "Agenda", icon: IconCalendar, perm: "atendimento.ver", group: "dia", mobile: "bar" },
  // Caixa: sem o caixa no CRM (`caixaOn` falso) só "Fechar o dia" vale: o item aponta para ele e sai da barra do celular (vai para o "Mais").
  { key: "caixa", href: "/caixa", label: "Caixa", icon: IconMoney, perm: "caixa.operar", group: "dia", mobile: "bar" },
  { key: "clientes", href: "/contatos", label: "Clientes", icon: IconContacts, perm: "contatos.ver", group: "dia", mobile: "mais" },
  { key: "relatorios", href: "/relatorios", label: "Relatórios", icon: IconChart, perm: "relatorios.ver", group: "gestao", mobile: "mais", match: ["/relatorios", "/jornada", "/caixa/comissao"] },
  { key: "servicos", href: "/servicos", label: "Serviços e pacotes", icon: IconScissors, perm: "atendimento.ver", group: "gestao", mobile: "mais" },
  { key: "config", href: "/config", label: "Configurações", icon: IconSettings, perm: null, group: "gestao", mobile: "mais" },
];

/**
 * O menu de quem entrou: itens sem permissão somem. Com o caixa no Avec, o Caixa aponta para "Fechar o dia" e vai para o "Mais" do celular.
 * Quem só tem os relatórios (o Contador, 26/10) não vê o Hoje (seria só um aviso) e tem Relatórios na barra do celular; sem operar o caixa,
 * Caixas da equipe e Fechamentos (que ele abre por Relatórios) acendem Relatórios.
 */
export function navFor(perms: readonly string[], opts: { caixaOn: boolean; estoqueOn?: boolean }): { dia: NavItem[]; gestao: NavItem[] } {
  const reportsOnly = isReportsOnly(perms);
  const items = NAV.filter((it) => (it.key === "config" ? canConfigure(perms) : it.key === "hoje" ? !reportsOnly : !it.perm || can(perms, it.perm)))
    .map((it) => (it.key === "caixa" && !opts.caixaOn ? { ...it, href: "/caixa/fechar-dia", mobile: "mais" as const } : it))
    .map((it) => (it.key === "relatorios" && !can(perms, "caixa.operar")
      ? { ...it, match: [...(it.match ?? [it.href]), "/caixa/equipe", "/caixa/fechamentos"], ...(reportsOnly ? { mobile: "bar" as const } : {}) } : it));
  return { dia: items.filter((it) => it.group === "dia"), gestao: items.filter((it) => it.group === "gestao") };
}

/** Pontua a rota: caminho mais longo vence. 0 = não bate. */
function score(href: string, pathname: string): number {
  const hit = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
  return hit ? href.length + 1 : 0;
}

/** O item aceso: entre todos, ganha a rota mais específica (ex.: /caixa/comissao é de Relatórios, não do Caixa). */
export function activeNav(items: NavItem[], pathname: string): { item: string | null } {
  let best: { key: string; s: number } | null = null;
  for (const it of items) {
    for (const href of it.match ?? [it.href]) {
      const s = score(href, pathname);
      if (s > (best?.s ?? 0)) best = { key: it.key, s };
    }
  }
  return { item: best?.key ?? null };
}
