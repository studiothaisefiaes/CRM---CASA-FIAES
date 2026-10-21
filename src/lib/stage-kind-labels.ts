/** Tipos de etapa (o código decide pelo tipo; Lote 1C) e o nome de cada tipo na tela de Etapas. Servidor e tela. */
export const STAGE_KINDS = ["lead", "atendimento", "followup", "proposta", "agendado", "na_casa", "atendido", "retorno", "fechado", "perdido"] as const;
export type StageKindName = (typeof STAGE_KINDS)[number];
export const KIND_LABEL: Record<StageKindName, string> = {
  lead: "Entrada", atendimento: "Conversa", followup: "Aguardando cliente", proposta: "Orçamento", agendado: "Agendado", na_casa: "Na Casa", atendido: "Atendida",
  retorno: "Retorno", fechado: "Ganho", perdido: "Perda",
};
