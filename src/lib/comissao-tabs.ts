/** As abas de Caixa › Comissão, pela permissão e pelos liga/desliga (puro: a página usa e o teste confere). */
import { can, type Perm } from "./permissions";

export type ComissaoAba = "relatorio" | "apagar" | "lancamentos" | "regras";
export type ComissaoTab = { value: ComissaoAba; label: string };

/**
 * Resumo (`comissao.ver`) · A pagar (`comissao.pagar`, some com "Pagar a comissão" desligado; as já pagas moram na mesma tela) · Lançamentos (`comissao.lancar`,
 * some com "Vale, bônus e desconto na comissão" desligado) · Regras (`comissao.regras`).
 */
export function comissaoTabs(perms: readonly string[], recursos: { vales: boolean; pagarComissao: boolean }): ComissaoTab[] {
  const has = (p: Perm) => can(perms, p);
  const all: [ComissaoAba, string, boolean][] = [
    ["relatorio", "Resumo", has("comissao.ver")],
    ["apagar", "A pagar", has("comissao.pagar") && recursos.pagarComissao],
    ["lancamentos", "Lançamentos", has("comissao.lancar") && recursos.vales],
    ["regras", "Regras", has("comissao.regras")],
  ];
  return all.filter(([, , ok]) => ok).map(([value, label]) => ({ value, label }));
}

/** A aba pedida na URL, se estiver na lista; senão a primeira; sem nenhuma, null. */
export const pickAba = (tabs: ComissaoTab[], requested: unknown): ComissaoAba | null =>
  tabs.find((t) => t.value === requested)?.value ?? tabs[0]?.value ?? null;
