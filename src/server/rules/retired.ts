import { isNull, notInArray, or, type SQL } from "drizzle-orm";
import { automations } from "../db/schema";

/**
 * Automações aposentadas (Plano 5, spec "Juntar e tirar"): o lembrete da véspera é um só, o de Configurações › Mensagens (`lembrete_d1`).
 * As linhas continuam no banco (em produção estão desligadas; sem migration), mas a tela, o índice, o motor e a trava do lembrete as ignoram.
 */
export const RETIRED_AUTOMATION_KEYS = ["lembrete_agendamento", "confirmacao_d1"] as const;

/** `where` das automações em uso: as personalizadas (sem chave) e as do seed que não foram aposentadas. */
export const activeAutomationFilter = (): SQL => or(isNull(automations.key), notInArray(automations.key, [...RETIRED_AUTOMATION_KEYS]))!;
