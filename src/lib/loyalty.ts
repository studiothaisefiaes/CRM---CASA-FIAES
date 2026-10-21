/** O modelo do motivo do prêmio quando a gestão limpa o campo ("Usar o texto sugerido"). `{programa}` vira o nome do programa. */
export const DEFAULT_REWARD_REASON = "Fidelidade: {programa}";

/** "Faltam N serviços para o prêmio." (mensagem fixa, não configurável). */
export const faltamParaPremio = (n: number) => (n === 1 ? "Falta 1 serviço para o prêmio." : `Faltam ${n} serviços para o prêmio.`);

/** Nome de cada tipo de linha do extrato de pontos. */
export const LOYALTY_REASON_LABEL = { servico: "Serviço", resgate: "Prêmio usado", saldo_avec: "Saldo trazido do Avec", ajuste: "Ajuste" } as const;
export type LoyaltyReason = keyof typeof LOYALTY_REASON_LABEL;

/** O que a tela mostra de um programa para uma cliente (sem nada de banco). */
export type LoyaltyStatusView = { programId: string; name: string; kind: "contagem" | "aniversario"; goal: number | null; balance: number; ready: boolean; rewardServiceIds: string[] };

/** O que o cartão do Resumo diz de cada programa: "Fiel da Fiaes 9 de 12". Pura: roda no servidor e no navegador. */
export function loyaltySummary(programs: LoyaltyStatusView[]) {
  return programs.map((p) => ({ id: p.programId, text: `${p.name} ${loyaltyLine(p)}`, ready: p.ready }));
}

/** "9 de 12" (contagem) ou "prêmio disponível" / "fora do mês do aniversário" (aniversário). */
export function loyaltyLine(p: LoyaltyStatusView): string {
  if (p.kind === "contagem") return `${p.balance} de ${p.goal}`;
  return p.ready ? "prêmio disponível" : "sem prêmio agora";
}
