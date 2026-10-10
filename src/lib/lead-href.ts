/** Único lugar que sabe para onde "abrir o lead" aponta. A T15 troca por /atendimento aqui. */
export const leadHref = (dealId: string | null | undefined) => (dealId ? `/funil?lead=${dealId}` : "/funil");
