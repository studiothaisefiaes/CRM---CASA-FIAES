/**
 * Configurações da agenda (Configurações › Agenda), sem migration: chaves `agenda_modo` e `agenda_regras` na tabela `settings`.
 * Módulo puro: o servidor valida e a tela mostra com os mesmos valores.
 *
 * - consulta: o CRM não cria ocupação nova (marcar, remarcar, bloquear e lista de espera são recusados); status, observação e
 *   cancelamento continuam. É o padrão: com o Avec online e a Avec IA ligados, um horário só do CRM ficaria livre no Avec.
 * - dupla: tudo ligado, com o lembrete "faça também no Avec".
 * - so_crm: a virada foi feita; sem o lembrete.
 */
export type AgendaMode = "consulta" | "dupla" | "so_crm";
export const AGENDA_MODES: AgendaMode[] = ["consulta", "dupla", "so_crm"];
export const isAgendaMode = (v: unknown): v is AgendaMode => typeof v === "string" && (AGENDA_MODES as string[]).includes(v);

/** Passo da grade e das sugestões, em minutos. */
export const STEP_OPTIONS = [10, 15, 20, 30, 60] as const;
export type AgendaRules = { passoMin: number };
export const DEFAULT_AGENDA_RULES: AgendaRules = { passoMin: 30 };

export const CONSULTA_MSG = "A agenda do CRM está só para consulta. A gestão muda em Configurações › Agenda.";
export const AVEC_TAMBEM_MSG = "Enquanto o Avec estiver ligado, faça também no Avec.";
