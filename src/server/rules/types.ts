import { z } from "zod";

/** Gatilhos: o "Quando" de uma automação. */
export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sem_resposta_minutos"), minutes: z.number().int().min(1).max(10_080), useStageSla: z.boolean().optional() }),
  z.object({ type: z.literal("parado_dias"), days: z.number().int().min(1).max(365), useStageLimit: z.boolean().optional() }),
  z.object({ type: z.literal("sem_retorno_cliente_dias"), days: z.number().int().min(1).max(365) }),
  z.object({ type: z.literal("aniversario_em_dias"), days: z.number().int().min(0).max(60) }),
  z.object({ type: z.literal("data_cobranca") }),
  z.object({ type: z.literal("data_recontato") }),
  z.object({ type: z.literal("agendamento_em_horas"), hours: z.number().int().min(1).max(168) }),
]);

/** Condições: o "Se". */
export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("etapa_em"), stages: z.array(z.string()).min(1) }),
]);

/** Ações: o "Então". Mensagens aceitam {nome}, {etapa}, {minutos}, {dias}, {data}, {hora}. */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("alertar_responsavel"), message: z.string().min(3).max(200) }),
  z.object({ type: z.literal("alertar_gestao"), message: z.string().min(3).max(200) }),
  z.object({ type: z.literal("escalar_gestao") }),
  z.object({ type: z.literal("mover_para_etapa"), stage: z.string() }),
  z.object({ type: z.literal("mover_para_proximo_followup") }),
  z.object({ type: z.literal("enviar_mensagem"), message: z.string().min(3).max(1000) }),
  /** Enquete de escolha única com as opções de `CONFIRMACAO_OPCOES`; o voto atualiza o lead (ver webhook). */
  z.object({ type: z.literal("enviar_enquete_confirmacao"), message: z.string().min(3).max(255) }),
]);

/** Opções da enquete de confirmação: "Confirmo" marca o lead como confirmado; "Preciso remarcar" cria a tarefa de remarcar. */
export const CONFIRMACAO_OPCOES = { confirmo: "Confirmo", remarcar: "Preciso remarcar" } as const;
export const REMARCAR_TAREFA = "Remarcar horário";;

export const automationInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  enabled: z.boolean(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(3),
  actions: z.array(actionSchema).min(1).max(4),
}).superRefine((v, ctx) => {
  if (v.trigger.type !== "sem_resposta_minutos" && v.actions.some((a) => a.type === "escalar_gestao"))
    ctx.addIssue({ code: "custom", path: ["actions"], message: "Escalar para a gestão só vale quando o gatilho é lead sem resposta." });
});

export type Trigger = z.infer<typeof triggerSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type AutomationInput = z.infer<typeof automationInputSchema>;

export const TRIGGER_LABELS: Record<Trigger["type"], string> = {
  sem_resposta_minutos: "Lead ficar sem resposta por X minutos",
  parado_dias: "Lead ficar parado na mesma etapa por X dias",
  sem_retorno_cliente_dias: "Cliente não responder por X dias",
  aniversario_em_dias: "Faltar X dias para o aniversário",
  data_cobranca: "Chegar a data de cobrança",
  data_recontato: "Chegar a data de recontato",
  agendamento_em_horas: "Faltar X horas para o agendamento",
};

export const ACTION_LABELS: Record<Action["type"], string> = {
  alertar_responsavel: "Alertar quem é responsável",
  alertar_gestao: "Avisar a gestão",
  escalar_gestao: "Escalar o alerta para a gestão",
  mover_para_etapa: "Mover para a etapa",
  mover_para_proximo_followup: "Mover para o próximo follow-up",
  enviar_mensagem: "Enviar mensagem à cliente no WhatsApp",
  enviar_enquete_confirmacao: "Enviar enquete de confirmação no WhatsApp",
};
