import { eq, inArray } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import { AGENDA_MODES, CONSULTA_MSG, DEFAULT_AGENDA_RULES, isAgendaMode, STEP_OPTIONS, type AgendaMode, type AgendaRules } from "../../../lib/agenda-settings";

const MODE_KEY = "agenda_modo", RULES_KEY = "agenda_regras";
const isStep = (v: unknown): v is number => (STEP_OPTIONS as readonly unknown[]).includes(v);

/** Modo da agenda. Sem chave (produção antes da escolha do dono) ou com valor estranho: "consulta". */
export async function getAgendaMode(tx: Tx | Db = db): Promise<AgendaMode> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, MODE_KEY));
  return isAgendaMode(r?.value) ? r.value : "consulta";
}

/** Passo da grade e das sugestões (padrão 30 min). */
export async function getAgendaRules(tx: Tx | Db = db): Promise<AgendaRules> {
  const [r] = await tx.select().from(settings).where(eq(settings.key, RULES_KEY));
  const passo = (r?.value as { passoMin?: unknown } | undefined)?.passoMin;
  return { passoMin: isStep(passo) ? passo : DEFAULT_AGENDA_RULES.passoMin };
}

/**
 * Quem cria ocupação nova na agenda (bloqueio no 6A; marcar, remarcar e lista de espera no 6B) chama antes: no modo consulta, recusa
 * com a frase da tela. Status, observação e cancelamento NÃO passam por aqui (valem em qualquer modo). Devolve o modo, para a tela
 * mostrar o lembrete "faça também no Avec" no modo dupla.
 */
export async function assertCanBook(tx: Tx | Db = db): Promise<AgendaMode> {
  const mode = await getAgendaMode(tx);
  if (mode === "consulta") throw new UserFacingError(CONSULTA_MSG);
  return mode;
}

/** Configurações › Agenda: modo e passo. Só a gestão (config.sistema); auditado com de/para. */
export async function saveAgendaSettings(input: { mode: AgendaMode; passoMin: number }, userId: string): Promise<void> {
  if (!AGENDA_MODES.includes(input.mode)) throw new UserFacingError("Escolha consulta, dupla ou só CRM.");
  if (!isStep(input.passoMin)) throw new UserFacingError("Escolha um passo de 10, 15, 20, 30 ou 60 minutos.");
  const rules: AgendaRules = { passoMin: input.passoMin };
  await db.transaction(async (tx) => {
    const before = Object.fromEntries((await tx.select().from(settings).where(inArray(settings.key, [MODE_KEY, RULES_KEY]))).map((r) => [r.key, r.value]));
    for (const [key, value] of [[MODE_KEY, input.mode], [RULES_KEY, rules]] as const) {
      await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    }
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: MODE_KEY, data: { de: { modo: before[MODE_KEY] ?? null, regras: before[RULES_KEY] ?? null }, para: { modo: input.mode, regras: rules } } });
  });
}
