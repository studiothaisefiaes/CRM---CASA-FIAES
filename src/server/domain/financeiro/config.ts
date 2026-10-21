import { eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import type { Actor } from "../agenda/actor";
import { can } from "@/lib/permissions";
import { CONTAS_A_PAGAR_OFF, isRepetirMaxMeses, isVenceEmDias, readFinanceiroConfig, REPETIR_MAX_MESES_LIMITS, VENCE_EM_DIAS_LIMITS, type FinanceiroConfig } from "@/lib/financeiro-settings";

const KEY = "financeiro_config";

export async function getFinanceiroConfig(q: Tx | Db = db): Promise<FinanceiroConfig> {
  const [r] = await q.select().from(settings).where(eq(settings.key, KEY));
  return readFinanceiroConfig(r?.value);
}

/** Escritas de Contas a pagar param aqui quando a função está desligada (a lista não passa por aqui). */
export async function assertContasAPagarOn(q: Tx | Db = db): Promise<FinanceiroConfig> {
  const c = await getFinanceiroConfig(q);
  if (!c.contasAPagar) throw new UserFacingError(CONTAS_A_PAGAR_OFF);
  return c;
}

/** Configurações › Financeiro (config.sistema); auditado com de/para. */
export async function saveFinanceiroConfig(c: FinanceiroConfig, actor: Actor): Promise<void> {
  if (!can(actor.perms, "config.sistema")) throw new UserFacingError("Você não tem permissão para configurar o Financeiro.");
  if (!isVenceEmDias(c.venceEmDias)) throw new UserFacingError(`Em "Vence em até", use de ${VENCE_EM_DIAS_LIMITS.min} a ${VENCE_EM_DIAS_LIMITS.max} dias.`);
  if (!isRepetirMaxMeses(c.repetirMaxMeses)) throw new UserFacingError(`Em "Repetir por até", use de ${REPETIR_MAX_MESES_LIMITS.min} a ${REPETIR_MAX_MESES_LIMITS.max} meses.`);
  const para: FinanceiroConfig = { contasAPagar: !!c.contasAPagar, resultado: !!c.resultado, venceEmDias: c.venceEmDias, repetirMaxMeses: c.repetirMaxMeses };
  await db.transaction(async (tx) => {
    const de = await getFinanceiroConfig(tx);
    await tx.insert(settings).values({ key: KEY, value: para }).onConflictDoUpdate({ target: settings.key, set: { value: para, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId: actor.id, action: "financeiro_configurado", entity: "settings", entityId: KEY, data: { de, para } });
  });
}
