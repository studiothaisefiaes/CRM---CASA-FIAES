/** Tipos de etapa para as telas (o navegador não lê o banco): decidir pelo tipo, nunca pela chave. */
export const CLOSED_STAGE_KINDS = ["fechado", "perdido"] as const;
/** Etapas de onde se agenda (Agendar abre a folha de data e hora). */
export const SCHEDULABLE_KINDS = ["lead", "atendimento", "followup", "proposta", "retorno", "atendido"] as const;
export const isSchedulable = (kind: string | null | undefined) => (SCHEDULABLE_KINDS as readonly string[]).includes(kind ?? "");
/** A chave da etapa de um tipo (a 1ª da lista, que já vem na ordem e só com as ativas). */
export const keyOfKind = (stages: readonly { key: string; kind: string }[], kind: string): string | null => stages.find((s) => s.kind === kind)?.key ?? null;
