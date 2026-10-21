import type { AutomationInput } from "./types";

/**
 * Modelos de automação: pontos de partida para a gestão. "Começar de um modelo" cria a automação já DESLIGADA
 * (nenhum modelo liga sozinho) e abre o editor; quem liga é a gestão, depois de ler o aviso de envio real.
 */
export type AutomationTemplate = { id: string; name: string; description: string; rule: AutomationInput };

const SEND_TYPES = new Set(["enviar_mensagem", "enviar_enquete_confirmacao", "enviar_arquivo", "pedir_avaliacao"]);
/** A automação manda algo à cliente pelo WhatsApp? (ligar exige a confirmação de envio real) */
export const sendsMessages = (actions: readonly { type: string }[]) => actions.some((a) => SEND_TYPES.has(a.type));

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
  {
    id: "aviso-recebimento",
    name: "Aviso de que a mensagem foi recebida",
    description: "Se a cliente nova ficar sem resposta por alguns minutos, ela recebe um aviso de que a Casa já vai atender. Fora do expediente, use a Resposta fora do horário.",
    rule: {
      name: "Aviso de que a mensagem foi recebida", enabled: false,
      trigger: { type: "sem_resposta_minutos", minutes: 10 },
      conditions: [{ type: "etapa_em", stages: ["lead"] }],
      actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! Recebemos sua mensagem e já vamos te responder. Obrigada por esperar!" }],
    },
  },
  {
    id: "retorno-ciclo-servico",
    name: "Convite de retorno pelo ciclo do serviço",
    description: "Quando chega a data de recontato (calculada pelo ciclo do serviço, em Listas), a cliente recebe um convite para voltar.",
    rule: {
      name: "Convite de retorno pelo ciclo do serviço", enabled: false,
      trigger: { type: "data_recontato" },
      conditions: [],
      actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! Já está na hora de cuidar dos seus cabelos de novo. Quer que eu veja um horário para você?" }],
    },
  },
  {
    id: "parado-alerta",
    name: "Conversa parada na etapa: avisar quem atende",
    description: "Quando uma conversa fica parada na mesma etapa por 3 dias, quem atende recebe um alerta. Não envia nada para a cliente.",
    rule: {
      name: "Conversa parada na etapa: avisar quem atende", enabled: false,
      trigger: { type: "parado_dias", days: 3 },
      conditions: [{ type: "etapa_em", stages: ["atendimento", "followup_1", "followup_2", "followup_3", "followup_4"] }],
      actions: [{ type: "alertar_responsavel", message: "{nome} está parado em {etapa} há {dias} dias" }],
    },
  },
  {
    id: "sem-resposta-escalar",
    name: "Sem resposta há 15 minutos: escalar para a gestão",
    description: "Se a cliente continua sem resposta depois de 15 minutos, o alerta sobe para a gestão. Não envia nada para a cliente.",
    rule: {
      name: "Sem resposta há 15 minutos: escalar para a gestão", enabled: false,
      trigger: { type: "sem_resposta_minutos", minutes: 15 },
      conditions: [{ type: "etapa_em", stages: ["lead", "atendimento"] }],
      actions: [{ type: "escalar_gestao" }],
    },
  },
  {
    id: "aniversario",
    name: "Parabéns no aniversário",
    description: "No dia do aniversário, a cliente recebe uma mensagem de parabéns.",
    rule: {
      name: "Parabéns no aniversário", enabled: false,
      trigger: { type: "aniversario_em_dias", days: 0 },
      conditions: [],
      actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! A Casa Fiaes deseja um feliz aniversário, com muito carinho. Quando quiser comemorar com a gente, é só chamar!" }],
    },
  },
  {
    id: "followup-orcamento",
    name: "Retomar a conversa depois do orçamento",
    description: "Se a cliente não responder por 2 dias depois do atendimento, ela recebe uma mensagem de retomada.",
    rule: {
      name: "Retomar a conversa depois do orçamento", enabled: false,
      trigger: { type: "sem_retorno_cliente_dias", days: 2 },
      conditions: [{ type: "etapa_em", stages: ["atendimento"] }],
      actions: [{ type: "enviar_mensagem", message: "Oi, {nome}! Ficou com alguma dúvida sobre o que conversamos? Posso reservar um horário para você." }],
    },
  },
];
