import { z } from "zod";

/** Gatilhos: o "Quando" de uma automação. */
export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("sem_resposta_minutos"), minutes: z.number().int().min(1).max(10_080), useStageSla: z.boolean().optional() }),
  z.object({ type: z.literal("parado_dias"), days: z.number().int().min(1).max(365), useStageLimit: z.boolean().optional() }),
  z.object({ type: z.literal("sem_retorno_cliente_dias"), days: z.number().int().min(1).max(365) }),
  /** A Casa respondeu e a cliente não voltou: X horas de EXPEDIENTE desde a última mensagem da Casa (Lote 1C). */
  z.object({ type: z.literal("casa_falou_por_ultimo_horas"), hours: z.number().int().min(1).max(72) }),
  z.object({ type: z.literal("aniversario_em_dias"), days: z.number().int().min(0).max(60) }),
  z.object({ type: z.literal("data_cobranca") }),
  z.object({ type: z.literal("data_recontato") }),
  z.object({ type: z.literal("agendamento_em_horas"), hours: z.number().int().min(1).max(168) }),
  /* Por acontecimento (Fase B, Task 6): agem na hora em que acontece (src/server/rules/events.ts), nunca no motor de cada minuto. */
  /** A cliente escreveu uma destas palavras (sem acento e sem maiúscula, palavra inteira). */
  z.object({ type: z.literal("cliente_escreveu"), words: z.array(z.string().trim().min(1).max(60)).min(1).max(20) }),
  /** 1ª mensagem de um contato que nunca falou com a Casa. */
  z.object({ type: z.literal("contato_novo") }),
  z.object({ type: z.literal("ligacao_perdida") }),
  z.object({ type: z.literal("midia_recebida"), kinds: z.array(z.enum(["image", "audio", "video", "document"])).min(1).max(4) }),
  /** Etiqueta colocada pela equipe ou pelo menu (a posta por regra não dispara: sem laço). */
  z.object({ type: z.literal("etiqueta_colocada"), tag: z.string().trim().min(1).max(30) }),
]);

/** Gatilhos por acontecimento: o motor de cada minuto (`runRules`) os ignora; quem os roda é `runEventRules`. */
export const EVENT_TRIGGERS: ReadonlySet<Trigger["type"]> = new Set<Trigger["type"]>(["cliente_escreveu", "contato_novo", "ligacao_perdida", "midia_recebida", "etiqueta_colocada"]);
export const isEventTrigger = (t: { type: string }) => EVENT_TRIGGERS.has(t.type as Trigger["type"]);

/** Condições: o "Se". */
export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("etapa_em"), stages: z.array(z.string()).min(1) }),
  /** Casa aberta (true) ou fechada (false) no horário de atendimento, com os Dias especiais. */
  z.object({ type: z.literal("casa_aberta"), aberta: z.boolean() }),
  z.object({ type: z.literal("tem_etiqueta"), tag: z.string().trim().min(1).max(30), tem: z.boolean() }),
]);

/**
 * Atraso de uma ação que envia (minutos depois do disparo; vira `notBefore` na fila). O teto do formato é o maior valor possível do número
 * "Atraso máximo de uma ação" (função Regras por acontecimento); o valor configurado é conferido ao salvar a regra.
 */
export const DELAY_MAX_ABS = 1440;
const delay = z.number().int().min(0).max(DELAY_MAX_ABS).optional();

/** Ações: o "Então". Mensagens aceitam {nome}, {etapa}, {minutos}, {dias}, {data}, {hora}. */
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("alertar_responsavel"), message: z.string().min(3).max(200) }),
  z.object({ type: z.literal("alertar_gestao"), message: z.string().min(3).max(200) }),
  z.object({ type: z.literal("escalar_gestao") }),
  z.object({ type: z.literal("mover_para_etapa"), stage: z.string() }),
  z.object({ type: z.literal("mover_para_proximo_followup") }),
  /** Aguardando cliente com as tentativas D+1, D+3, D+7 (tarefas com aviso; nunca mensagem). Só sai de Novo contato / Em conversa. */
  z.object({ type: z.literal("aguardar_cliente") }),
  z.object({ type: z.literal("enviar_mensagem"), message: z.string().min(3).max(1000), delayMinutes: delay }),
  /** Enquete de escolha única com as opções de `CONFIRMACAO_OPCOES`; o voto atualiza o lead (ver webhook). */
  z.object({ type: z.literal("enviar_enquete_confirmacao"), message: z.string().min(3).max(255) }),
  /* Fase B, Task 7. Ações internas (etiqueta, passar para, nota, status) valem mesmo com as Automáticas pausadas; o arquivo entra na fila. */
  z.object({ type: z.literal("por_etiqueta"), tag: z.string().trim().min(1).max(30) }),
  z.object({ type: z.literal("tirar_etiqueta"), tag: z.string().trim().min(1).max(30) }),
  /** Para um setor (quem dele está Disponível) ou para uma pessoa. */
  z.object({ type: z.literal("passar_para"), to: z.union([z.object({ team: z.string().uuid() }).strict(), z.object({ user: z.string().uuid() }).strict()]) }),
  /** Nota interna com o texto que a gestão escreveu; sai como "Regra: {nome da regra}". */
  z.object({ type: z.literal("escrever_nota"), text: z.string().trim().min(3).max(500) }),
  /** Arquivo da Biblioteca pela fila; legenda vazia = sem legenda. */
  z.object({ type: z.literal("enviar_arquivo"), fileId: z.string().uuid(), caption: z.string().max(1000).nullish(), delayMinutes: delay }),
  z.object({ type: z.literal("mudar_status"), status: z.enum(["aberto", "aguardando", "resolvido"]) }),
  /** Fase B, Task 9: a enquete de 1 a 5 da Pesquisa de satisfação, com o título de Depois do atendimento. Só com o modo `pesquisa` ligado. */
  z.object({ type: z.literal("pedir_avaliacao") }),
]);

/** Opções da enquete de confirmação: "Confirmo" marca o lead como confirmado; "Preciso remarcar" cria a tarefa de remarcar. */
export const CONFIRMACAO_OPCOES = { confirmo: "Confirmo", remarcar: "Preciso remarcar" } as const;
export const REMARCAR_TAREFA = "Remarcar horário";

/** Até quantas ações uma regra tem. */
export const MAX_ACTIONS = 6;

export const automationInputSchema = z.object({
  name: z.string().trim().min(3).max(80),
  enabled: z.boolean(),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(3),
  actions: z.array(actionSchema).min(1).max(MAX_ACTIONS),
}).superRefine((v, ctx) => {
  if (v.trigger.type !== "sem_resposta_minutos" && v.actions.some((a) => a.type === "escalar_gestao"))
    ctx.addIssue({ code: "custom", path: ["actions"], message: "Escalar para a gestão só vale quando o gatilho é conversa sem resposta." });
});

export type Trigger = z.infer<typeof triggerSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Action = z.infer<typeof actionSchema>;
export type AutomationInput = z.infer<typeof automationInputSchema>;

export const TRIGGER_LABELS: Record<Trigger["type"], string> = {
  sem_resposta_minutos: "Conversa ficar sem resposta por X minutos",
  parado_dias: "Conversa ficar parada na mesma etapa por X dias",
  sem_retorno_cliente_dias: "Cliente não responder por X dias",
  casa_falou_por_ultimo_horas: "A Casa falou por último há X horas de expediente",
  aniversario_em_dias: "Faltar X dias para o aniversário",
  data_cobranca: "Chegar a data de cobrança",
  data_recontato: "Chegar a data de recontato",
  agendamento_em_horas: "Faltar X horas para o agendamento",
  cliente_escreveu: "A cliente escrever uma destas palavras",
  contato_novo: "Chegar um contato novo",
  ligacao_perdida: "Ligação perdida",
  midia_recebida: "A cliente mandar foto, áudio, vídeo ou documento",
  etiqueta_colocada: "Uma etiqueta ser colocada",
};

export const MEDIA_KIND_LABEL: Record<"image" | "audio" | "video" | "document", string> = { image: "foto", audio: "áudio", video: "vídeo", document: "documento" };

/** "a", "a ou b", "a, b ou c" */
const orList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ou ${xs.at(-1)}`);

/** O "Quando" em frase legível (cartão e editor de Configurações › Automações). */
export function describeTrigger(t: Trigger): string {
  switch (t.type) {
    case "sem_resposta_minutos": return t.useStageSla ? "a conversa passar do prazo de resposta da etapa" : `a conversa ficar sem resposta por ${t.minutes} min`;
    case "parado_dias": return t.useStageLimit ? "a conversa passar do limite parado da etapa" : `a conversa ficar parada na etapa por ${t.days} dia${t.days > 1 ? "s" : ""}`;
    case "sem_retorno_cliente_dias": return `cliente não responder por ${t.days} dia${t.days > 1 ? "s" : ""}`;
    case "casa_falou_por_ultimo_horas": return `a Casa falar por último e passar ${t.hours} h de expediente`;
    case "aniversario_em_dias": return `faltar ${t.days} dia${t.days === 1 ? "" : "s"} para o aniversário`;
    case "data_cobranca": return "chegar a data de cobrança";
    case "data_recontato": return "chegar a data de recontato";
    case "agendamento_em_horas": return `faltar ${t.hours} h para o agendamento`;
    case "cliente_escreveu": return `a cliente escrever ${orList(t.words.map((w) => `'${w}'`))}`;
    case "contato_novo": return "chegar um contato novo";
    case "ligacao_perdida": return "a Casa perder uma ligação";
    case "midia_recebida": return `a cliente mandar ${orList(t.kinds.map((k) => MEDIA_KIND_LABEL[k]))}`;
    case "etiqueta_colocada": return `a etiqueta ${t.tag} ser colocada`;
  }
}

/** O "Se" em frase legível, para emendar no "Quando" (", em Novo contato, com a Casa aberta"). Sem condição: "". */
export function describeConditions(conds: Condition[], stages: { key: string; name: string }[]): string {
  return conds.map((c) => {
    switch (c.type) {
      case "etapa_em": return `, em ${orList(c.stages.map((k) => stages.find((s) => s.key === k)?.name ?? k))}`;
      case "casa_aberta": return c.aberta ? ", com a Casa aberta" : ", com a Casa fechada";
      case "tem_etiqueta": return `, ${c.tem ? "com" : "sem"} a etiqueta ${c.tag}`;
    }
  }).join("");
}

export const ACTION_LABELS: Record<Action["type"], string> = {
  alertar_responsavel: "Alertar quem é responsável",
  alertar_gestao: "Avisar a gestão",
  escalar_gestao: "Escalar o alerta para a gestão",
  mover_para_etapa: "Mover para a etapa",
  mover_para_proximo_followup: "Mover para Aguardando cliente",
  aguardar_cliente: "Marcar como aguardando cliente (3 tentativas; padrão D+1, D+3, D+7, ajustável em Etapas)",
  enviar_mensagem: "Enviar mensagem à cliente no WhatsApp",
  enviar_enquete_confirmacao: "Enviar enquete de confirmação no WhatsApp",
  por_etiqueta: "Pôr a etiqueta",
  tirar_etiqueta: "Tirar a etiqueta",
  passar_para: "Passar para",
  escrever_nota: "Escrever uma nota",
  enviar_arquivo: "Enviar um arquivo da Biblioteca",
  mudar_status: "Mudar o status para",
  pedir_avaliacao: "Mandar a Pesquisa de satisfação",
};

/** Os status que a regra pode pôr (os mesmos do seletor da conversa). */
export const STATUS_LABELS: Record<"aberto" | "aguardando" | "resolvido", string> = { aberto: "Aberto", aguardando: "Aguardando", resolvido: "Resolvido" };

/** "Na hora" ou "Depois de 10 min" / "Depois de 1 h 30 min" (linha do tempo do editor). */
export function delayLabel(min: number | undefined | null): string {
  if (!min) return "Na hora";
  const h = Math.floor(min / 60), m = min % 60;
  return `Depois de ${h ? `${h} h` : ""}${h && m ? " " : ""}${m ? `${m} min` : ""}`;
}
