import { eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { aiSuggestions, auditLog, settings } from "../db/schema";
import { DEFAULT_MODEL } from "./client";

/**
 * Configuração e teto de gasto da sugestão por IA. Nasce DESLIGADA (migration 0042); o dono liga em Configurações › Conversas.
 * O teto soma o custo gravado em `ai_suggestions` (mês e chamadas do dia, no horário de Salvador): passou, para de gerar.
 */
export const AI_SETTING = "ia_sugestao";
export const AI_DEFAULTS = { enabled: false, monthlyLimitUsd: 40, dailyCalls: 1500 } as const;
export type AiSettings = { enabled: boolean; monthlyLimitUsd: number; dailyCalls: number };

export const aiSettingsSchema = z.object({
  enabled: z.boolean(),
  monthlyLimitUsd: z.number().min(1, "Use de US$ 1 a US$ 200 por mês.").max(200, "Use de US$ 1 a US$ 200 por mês."),
  dailyCalls: z.number().int().min(10, "Use de 10 a 10.000 chamadas por dia.").max(10_000, "Use de 10 a 10.000 chamadas por dia."),
});

export async function getAiSettings(): Promise<AiSettings> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, AI_SETTING));
  const v = (r?.value ?? {}) as Partial<AiSettings>;
  const num = (x: unknown, d: number, min: number, max: number) => (typeof x === "number" && Number.isFinite(x) && x >= min && x <= max ? x : d);
  return {
    enabled: v.enabled === true,
    monthlyLimitUsd: num(v.monthlyLimitUsd, AI_DEFAULTS.monthlyLimitUsd, 1, 200),
    dailyCalls: num(v.dailyCalls, AI_DEFAULTS.dailyCalls, 10, 10_000),
  };
}

export async function saveAiSettings(input: AiSettings, userId: string): Promise<AiSettings> {
  const value = aiSettingsSchema.parse(input);
  await db.insert(settings).values({ key: AI_SETTING, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: AI_SETTING, data: value });
  return value;
}

/** Chave e modelo do servidor (.env). Sem chave a IA fica parada, sem erro. */
export function aiEnv(): { apiKey: string | null; model: string; baseUrl?: string } {
  // AI_BASE_URL só para teste (e2e aponta para um endereço morto: nunca chama a Anthropic de verdade).
  return { apiKey: process.env.ANTHROPIC_API_KEY?.trim() || null, model: process.env.AI_MODEL?.trim() || DEFAULT_MODEL, baseUrl: process.env.AI_BASE_URL?.trim() || undefined };
}

/** Salvador é UTC-3 o ano todo: início do dia e do mês de lá, em UTC. */
const OFFSET = 3 * 3_600_000;
export function bahiaDayStart(now: Date): Date {
  const l = new Date(now.getTime() - OFFSET);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()) + OFFSET);
}
export function bahiaMonthStart(now: Date): Date {
  const l = new Date(now.getTime() - OFFSET);
  return new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) + OFFSET);
}

export type AiSpend = { monthMicros: number; monthCalls: number; todayCalls: number };
export async function aiSpend(now = new Date()): Promise<AiSpend> {
  const day = bahiaDayStart(now).toISOString();
  const [r] = await db.select({
    micros: sql<number>`coalesce(sum(${aiSuggestions.costUsdMicros}), 0)::bigint`,
    calls: sql<number>`count(*)::int`,
    today: sql<number>`count(*) filter (where ${aiSuggestions.createdAt} >= ${day}::timestamptz)::int`,
  }).from(aiSuggestions).where(gte(aiSuggestions.createdAt, bahiaMonthStart(now)));
  return { monthMicros: Number(r?.micros ?? 0), monthCalls: Number(r?.calls ?? 0), todayCalls: Number(r?.today ?? 0) };
}

export type BudgetState = "ok" | "teto_mes" | "teto_dia";
/** Passou do limite do mês (em dólar) ou das chamadas do dia: não gera mais (nem o "Outra"). */
export function budgetState(s: Pick<AiSettings, "monthlyLimitUsd" | "dailyCalls">, spend: AiSpend): BudgetState {
  if (spend.monthMicros >= Math.round(s.monthlyLimitUsd * 1_000_000)) return "teto_mes";
  if (spend.todayCalls >= s.dailyCalls) return "teto_dia";
  return "ok";
}
