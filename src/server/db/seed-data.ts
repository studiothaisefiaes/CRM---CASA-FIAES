import type { AutomationInput } from "../rules/types";

export const DEFAULT_STAGES = [
  { key: "lead", name: "Lead", kind: "lead", position: 0, slaMinutes: 2, staleDays: 1, color: "#b8863f" },
  { key: "atendimento", name: "Atendimento", kind: "atendimento", position: 1, slaMinutes: 3, staleDays: 1, color: "#121212" },
  { key: "agendado", name: "Agendado", kind: "agendado", position: 2, slaMinutes: 3, staleDays: null, color: "#2f6b4f" },
  { key: "followup_1", name: "Follow-up 1", kind: "followup", position: 3, slaMinutes: 3, staleDays: 1, color: "#5c5c5c" },
  { key: "followup_2", name: "Follow-up 2", kind: "followup", position: 4, slaMinutes: 3, staleDays: 1, color: "#5c5c5c" },
  { key: "followup_3", name: "Follow-up 3", kind: "followup", position: 5, slaMinutes: 3, staleDays: 1, color: "#5c5c5c" },
  { key: "followup_4", name: "Follow-up 4", kind: "followup", position: 6, slaMinutes: 3, staleDays: 1, color: "#5c5c5c" },
  { key: "fechado", name: "Fechado", kind: "fechado", position: 7, slaMinutes: null, staleDays: null, color: "#2f6b4f" },
  { key: "perdido", name: "Perdido", kind: "perdido", position: 8, slaMinutes: null, staleDays: null, color: "#9a958c" },
] as const;

export const DEFAULT_LISTS = {
  objection: ["Preço", "Distância", "Sem horário", "Vai pensar", "Medo do resultado", "Já tem salão"],
  lost_reason: ["Preço", "Não respondeu mais", "Escolheu outro salão", "Sem horário disponível", "Mora longe", "Só pesquisando"],
  service: ["Avaliação capilar", "Tratamento de queda", "Coloração", "Corte", "Hidratação"],
  origin: ["WhatsApp", "Anúncio", "Instagram", "Site", "Indicação", "Já é cliente"],
} as const;

/** Ciclo de retorno (dias) dos serviços recorrentes. */
export const SERVICE_CYCLE_DAYS: Record<string, number> = { "Coloração": 35, "Hidratação": 30 };

export const DEFAULT_QUICK_REPLIES = [
  { label: "boas-vindas", body: "Oi, {nome}! Que bom falar com você. Sou da Casa Fiaes. Como posso te ajudar?" },
  { label: "avaliacao", body: "O primeiro passo é uma avaliação gratuita aqui na Casa. Quer que eu veja um horário pra você?" },
  { label: "endereco", body: "Estamos na Alameda das Seringueiras, 44, Caminho das Árvores, Salvador." },
  { label: "retomar", body: "Oi, {nome}! Passando para saber se ficou alguma dúvida. Posso reservar um horário pra você?" },
] as const;

export const DEFAULT_AUTOMATIONS: (AutomationInput & { key: string })[] = [
  {
    key: "lead_2min", name: "Lead novo sem resposta no prazo", enabled: true,
    trigger: { type: "sem_resposta_minutos", minutes: 2, useStageSla: true },
    conditions: [{ type: "etapa_em", stages: ["lead"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} está esperando resposta há {minutos} min" }],
  },
  {
    key: "gestao_10min", name: "Avisar a gestão: sem resposta há 10 minutos", enabled: true,
    trigger: { type: "sem_resposta_minutos", minutes: 10 },
    conditions: [{ type: "etapa_em", stages: ["lead", "atendimento", "followup_1", "followup_2", "followup_3", "followup_4"] }],
    actions: [{ type: "alertar_gestao", message: "{nome} está sem resposta há {minutos} min" }],
  },
  {
    key: "atendimento_3min", name: "Conversa sem resposta no prazo", enabled: true,
    trigger: { type: "sem_resposta_minutos", minutes: 3, useStageSla: true },
    conditions: [{ type: "etapa_em", stages: ["atendimento", "agendado", "followup_1", "followup_2", "followup_3", "followup_4"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} respondeu e está esperando há {minutos} min" }],
  },
  {
    key: "followup_diario", name: "Cliente não respondeu: próximo follow-up", enabled: true,
    trigger: { type: "sem_retorno_cliente_dias", days: 1 },
    conditions: [{ type: "etapa_em", stages: ["atendimento", "followup_1", "followup_2", "followup_3"] }],
    actions: [
      { type: "mover_para_proximo_followup" },
      { type: "alertar_responsavel", message: "{nome} foi para o {etapa}. Hora de retomar o contato" },
    ],
  },
  {
    key: "parado_1dia", name: "Lead parado além do limite da etapa", enabled: true,
    trigger: { type: "parado_dias", days: 1, useStageLimit: true },
    conditions: [{ type: "etapa_em", stages: ["lead", "atendimento", "followup_1", "followup_2", "followup_3", "followup_4"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} está parado em {etapa} há {dias} dia(s)" }],
  },
  {
    key: "aniversario_7d", name: "Aniversário em 7 dias", enabled: true,
    trigger: { type: "aniversario_em_dias", days: 7 },
    conditions: [],
    actions: [{ type: "alertar_responsavel", message: "Aniversário de {nome} em 7 dias. A mensagem está pronta no card" }],
  },
  {
    key: "cobranca", name: "Dia da cobrança", enabled: true,
    trigger: { type: "data_cobranca" },
    conditions: [],
    actions: [{ type: "alertar_responsavel", message: "Hoje é dia de cobrar {nome}" }],
  },
  {
    key: "lembrete_agendamento", name: "Lembrete do agendamento na véspera", enabled: false,
    trigger: { type: "agendamento_em_horas", hours: 24 },
    conditions: [{ type: "etapa_em", stages: ["agendado"] }],
    actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! Passando para lembrar do seu horário na Casa Fiaes: {data}, às {hora}. Pode confirmar respondendo esta mensagem?" }],
  },
  {
    key: "recontato", name: "Dia de recontato", enabled: true,
    trigger: { type: "data_recontato" },
    conditions: [],
    actions: [
      { type: "mover_para_etapa", stage: "atendimento" },
      { type: "alertar_responsavel", message: "Dia de recontato com {nome}. O lead voltou para Atendimento" },
    ],
  },
];
