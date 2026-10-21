import { eq, inArray } from "drizzle-orm";
import { db, type Tx } from "../db";
import { settings } from "../db/schema";
import { DEFAULT_HOURS, type BusinessHours } from "../../lib/business-hours";
import { FUNCOES, resolveFuncao, type FuncoesState } from "../../lib/funcoes";
import { especiaisOf, type SpecialDay } from "../../lib/special-days";

export const SPECIAL_DAYS_KEY = "dias_especiais";
const DIAS_ESPECIAIS = FUNCOES.find((f) => f.key === "dias_especiais")!;

const asWeek = (v: unknown): BusinessHours => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return DEFAULT_HOURS;
  const { especiais: _ignored, ...week } = v as BusinessHours;
  return week as BusinessHours;
};

/** Só a semana salva pela gestão (sem os Dias especiais): é o que a tela de horário edita. Padrão seg–sex 8–20, sáb 8–17. */
export async function getWeekHours(tx: Tx | typeof db = db): Promise<BusinessHours> {
  const rows = await tx.select().from(settings).where(eq(settings.key, "business_hours"));
  return asWeek(rows[0]?.value);
}

/**
 * Horário de atendimento salvo pela gestão (Configurações › Etapas) com os Dias especiais por cima (`especiais`): todo quem calcula
 * prazo, abre/fecha mensagem ou agenda enxerga o feriado sem mudar. Com a função Dias especiais desligada, vale só a semana.
 */
export async function getBusinessHours(tx: Tx | typeof db = db): Promise<BusinessHours> {
  const rows = await tx.select().from(settings).where(inArray(settings.key, ["business_hours", SPECIAL_DAYS_KEY, "funcoes"]));
  const by = new Map(rows.map((r) => [r.key, r.value]));
  const week = by.has("business_hours") ? asWeek(by.get("business_hours")) : DEFAULT_HOURS;
  const state = by.get("funcoes");
  const on = resolveFuncao(DIAS_ESPECIAIS, state && typeof state === "object" && !Array.isArray(state) ? (state as FuncoesState) : {}).on;
  if (!on) return week;
  const days = by.get(SPECIAL_DAYS_KEY);
  if (!Array.isArray(days) || !days.length) return week;
  return { ...week, especiais: especiaisOf(days as SpecialDay[]) };
}
