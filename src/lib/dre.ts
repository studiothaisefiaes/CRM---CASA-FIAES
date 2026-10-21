/** Linhas do Resultado (DRE): grupos de despesa (`finance_categories.dre_group`) e as linhas que vêm das vendas. */
export const DRE_EXPENSE_GROUPS = ["pessoal", "ocupacao", "operacao", "marketing", "impostos", "financeiras", "outras"] as const;
export type DreExpenseGroup = (typeof DRE_EXPENSE_GROUPS)[number];
export const isDreExpenseGroup = (v: unknown): v is DreExpenseGroup => (DRE_EXPENSE_GROUPS as readonly unknown[]).includes(v);

export type DreKey = "receita_servicos" | "receita_produtos" | "receita_pacotes" | "repasse_profissionais" | "taxas_cartao" | "custo_produtos" | DreExpenseGroup;
export const DRE_LABEL: Record<DreKey, string> = {
  receita_servicos: "Serviços",
  receita_produtos: "Produtos",
  receita_pacotes: "Pacotes",
  repasse_profissionais: "Comissões",
  taxas_cartao: "Taxas de cartão",
  custo_produtos: "Custo dos produtos vendidos",
  pessoal: "Pessoal",
  ocupacao: "Ocupação",
  operacao: "Operação",
  marketing: "Marketing",
  impostos: "Impostos",
  financeiras: "Despesas financeiras",
  outras: "Outras despesas",
};
