import type { AutomationInput } from "../rules/types";

/**
 * Funil da Casa (nova organização aprovada pelo dono, 16/10): Novo contato → Em conversa → Orçamento → Agendado → Na Casa → Atendida →
 * Hora de voltar / Perdido. "Aguardando cliente" virou status da conversa (e estado de Em conversa, com as tentativas) e "Fechado" saiu da escolha
 * (a conversa termina em Atendida): as duas ficam desativadas, só para o histórico antigo continuar com nome. As chaves antigas ficam
 * (o histórico e as automações usam); o código decide pelo `kind`. Follow-up 2 a 4 também desativadas.
 * O seed só INSERE etapas que faltam (onConflictDoNothing): em produção, nomes e etapas desativadas vêm de scripts/nova-organizacao-etapas.ts.
 */
export const DEFAULT_STAGES = [
  { key: "lead", name: "Novo contato", kind: "lead", position: 0, slaMinutes: 2, staleDays: 1, color: "#a87a2c", active: true },
  { key: "atendimento", name: "Em conversa", kind: "atendimento", position: 1, slaMinutes: 3, staleDays: 2, color: "#121212", active: true },
  { key: "followup_1", name: "Aguardando cliente", kind: "followup", position: 2, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
  { key: "orcamento", name: "Orçamento", kind: "proposta", position: 3, slaMinutes: 15, staleDays: null, color: "#8a6a2f", active: true },
  { key: "agendado", name: "Agendado", kind: "agendado", position: 4, slaMinutes: 3, staleDays: null, color: "#2f6b4f", active: true },
  // Na Casa (pedido do dono, 15/10): a cliente está no salão. Sem prazo de parado (staleDays null) e sem tentativas; mensagem dela segue o SLA.
  { key: "na_casa", name: "Na Casa", kind: "na_casa", position: 5, slaMinutes: 15, staleDays: null, color: "#b5654a", active: true },
  { key: "atendida", name: "Atendida", kind: "atendido", position: 6, slaMinutes: 15, staleDays: null, color: "#3d7a5c", active: true },
  { key: "retorno", name: "Hora de voltar", kind: "retorno", position: 7, slaMinutes: 15, staleDays: null, color: "#6b5b8a", active: true },
  { key: "fechado", name: "Fechado", kind: "fechado", position: 8, slaMinutes: null, staleDays: null, color: "#2f6b4f", active: false },
  { key: "perdido", name: "Perdido", kind: "perdido", position: 9, slaMinutes: null, staleDays: null, color: "#9a958c", active: true },
  { key: "followup_2", name: "Follow-up 2", kind: "followup", position: 20, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
  { key: "followup_3", name: "Follow-up 3", kind: "followup", position: 21, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
  { key: "followup_4", name: "Follow-up 4", kind: "followup", position: 22, slaMinutes: 3, staleDays: null, color: "#5c5c5c", active: false },
] as const;

export const DEFAULT_LISTS = {
  objection: ["Preço", "Distância", "Sem horário", "Vai pensar", "Medo do resultado", "Já tem salão"],
  lost_reason: ["Preço", "Não respondeu mais", "Escolheu outro salão", "Sem horário disponível", "Mora longe", "Só pesquisando", "Retorno não feito"],
  origin: ["WhatsApp", "Anúncio", "Instagram", "Site", "Indicação", "Já é cliente"],
} as const;

// Serviços NÃO vêm no seed: os nomes são os da Casa, cadastrados pela gestão em Configurações › Listas › Serviços antes de abrir para a equipe.

/**
 * Respostas prontas universais de partida (pedido do dono, 15/10): rascunhos no tom da Casa, curtos, que a gestão edita em Configurações.
 * Nada sai sozinho: só aparecem no "/" e vão assinadas pelo envio normal. O seed não sobrescreve as que já existem (onConflictDoNothing).
 */
export const DEFAULT_QUICK_REPLIES = [
  { label: "boas-vindas", folder: "Primeiro contato", body: "{saudacao}, {primeiro_nome}! Que bom falar com você. Aqui é a {meu_nome}, da Casa Fiaes. Como posso te ajudar?" },
  { label: "avaliacao", folder: "Primeiro contato", body: "O Método Fiaes® começa por uma avaliação do seu cabelo aqui na Casa: é nela que a gente entende o que ele precisa e passa os valores certinhos para você. Quer que eu veja um horário?" },
  { label: "fotos-cabelo", folder: "Primeiro contato", body: "Para adiantar, me manda 2 ou 3 fotos do seu cabelo com luz natural: de frente, de lado e de costas. Assim já te explico melhor como funciona." },
  // 21/10: no desenho do lembrete (data e hora em negrito numa linha própria). Só vale para instalação nova: o seed não sobrescreve.
  { label: "confirmar", folder: "Agendamento", body: "{saudacao}, {primeiro_nome}! 💛\n\nPassando para confirmar seu horário na Casa Fiaes:\n\n📅 *{data_horario}*\n✨ {servico} com {profissional}\n\nPosso confirmar?" },
  { label: "endereco", folder: "Agendamento", body: "Estamos na Alameda das Seringueiras, 44, Caminho das Árvores, Salvador. Se quiser, te mando a localização por aqui." },
  { label: "retomar", folder: "Relacionamento", body: "Oi, {primeiro_nome}! Passando para saber se ficou alguma dúvida. Posso reservar um horário para você?" },
  { label: "pos-atendimento", folder: "Pós-atendimento", body: "Oi, {primeiro_nome}! Como ficou o cabelo depois do atendimento? Conta para a gente, a sua opinião é muito importante." },
  { label: "aniversario", folder: "Relacionamento", body: "Feliz aniversário, {primeiro_nome}! 🎉 Toda a equipe da Casa Fiaes te deseja um dia lindo." },
] as const;

// Lote 0 (15/10): escalada para a gestão em 30 min; followup_diario e parado_1dia desligadas (o Lote 1C as substitui por casa_falou_4h e parado_etapa).
// O seed sobrescreve trigger/condições/ações das automações que a gestão nunca editou (seed.ts): os padrões daqui TÊM de ser os de produção.
export const DEFAULT_AUTOMATIONS: (AutomationInput & { key: string })[] = [
  {
    key: "lead_2min", name: "Conversa nova sem resposta no prazo", enabled: true,
    trigger: { type: "sem_resposta_minutos", minutes: 2, useStageSla: true },
    conditions: [{ type: "etapa_em", stages: ["lead"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} espera resposta (texto fixo: desde quando, prazo e dona)" }],
  },
  {
    key: "gestao_10min", name: "Escalar para a gestão: sem resposta há 30 minutos", enabled: true,
    trigger: { type: "sem_resposta_minutos", minutes: 30 },
    conditions: [{ type: "etapa_em", stages: ["lead", "atendimento", "followup_1", "followup_2", "followup_3", "followup_4", "orcamento", "atendida", "retorno"] }],
    actions: [{ type: "escalar_gestao" }],
  },
  {
    key: "atendimento_3min", name: "Conversa sem resposta no prazo", enabled: true,
    trigger: { type: "sem_resposta_minutos", minutes: 3, useStageSla: true },
    conditions: [{ type: "etapa_em", stages: ["atendimento", "agendado", "followup_1", "followup_2", "followup_3", "followup_4", "orcamento", "atendida", "retorno"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} espera resposta (texto fixo: desde quando, prazo e dona)" }],
  },
  {
    key: "followup_diario", name: "Cliente não respondeu: próximo follow-up", enabled: false,
    trigger: { type: "sem_retorno_cliente_dias", days: 1 },
    conditions: [{ type: "etapa_em", stages: ["atendimento", "followup_1", "followup_2", "followup_3"] }],
    actions: [
      { type: "mover_para_proximo_followup" },
      { type: "alertar_responsavel", message: "{nome} foi para o {etapa}. Hora de retomar o contato" },
    ],
  },
  {
    key: "parado_1dia", name: "Conversa parada além do limite da etapa", enabled: false,
    trigger: { type: "parado_dias", days: 1, useStageLimit: true },
    conditions: [{ type: "etapa_em", stages: ["lead", "atendimento", "followup_1", "followup_2", "followup_3", "followup_4"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} está parado em {etapa} há {dias} dia(s)" }],
  },
  {
    // Lote 1C: substitui o followup_diario. Sem mensagem: a conversa passa a aguardar a cliente e as tentativas viram combinados.
    key: "casa_falou_4h", name: "Casa falou por último há 4 h de expediente: aguardando cliente", enabled: true,
    trigger: { type: "casa_falou_por_ultimo_horas", hours: 4 },
    conditions: [{ type: "etapa_em", stages: ["atendimento"] }],
    actions: [{ type: "aguardar_cliente" }],
  },
  {
    // Lote 1C: substitui o parado_1dia. Só Novo contato e Em conversa (Aguardando é controlado pelas tentativas); um aviso por conversa.
    key: "parado_etapa", name: "Conversa parada além do limite da etapa (um aviso por conversa)", enabled: true,
    trigger: { type: "parado_dias", days: 1, useStageLimit: true },
    conditions: [{ type: "etapa_em", stages: ["lead", "atendimento"] }],
    actions: [{ type: "alertar_responsavel", message: "{nome} está em {etapa} há {dias} dia(s) sem próximo passo. Agende, retome ou resolva a conversa." }],
  },
  {
    key: "aniversario_7d", name: "Aniversário em 7 dias", enabled: true,
    trigger: { type: "aniversario_em_dias", days: 7 },
    conditions: [],
    actions: [{ type: "alertar_responsavel", message: "Aniversário de {nome}. Que tal mandar um parabéns?" }],
  },
  {
    key: "cobranca", name: "Dia da cobrança", enabled: true,
    trigger: { type: "data_cobranca" },
    conditions: [],
    actions: [{ type: "alertar_responsavel", message: "Hoje é dia de cobrar {nome}" }],
  },
  {
    key: "recontato", name: "Dia de recontato", enabled: true,
    trigger: { type: "data_recontato" },
    conditions: [],
    actions: [
      { type: "mover_para_etapa", stage: "atendimento" },
      { type: "alertar_responsavel", message: "Dia de recontato com {nome}. A conversa voltou para {etapa}" },
    ],
  },
];
