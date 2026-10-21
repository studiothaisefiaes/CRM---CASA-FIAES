import { eq } from "drizzle-orm";
import { db, type Db, type Tx } from "../../db";
import { auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import { isAssistentesMax, isIntBetween, isIsoDay, readCaixaRecursos, recursoOffMessage, RECIBO_TEXTO_MAX, RECURSO_KEYS, type CaixaRecursos, type RecursoKey } from "@/lib/caixa-recursos";

const KEY = "caixa_recursos";

export async function getCaixaRecursos(q: Tx | Db = db): Promise<CaixaRecursos> {
  const [r] = await q.select().from(settings).where(eq(settings.key, KEY));
  return readCaixaRecursos(r?.value);
}

/** Usar uma funcionalidade desligada em Configurações › Caixa é recusado com a frase de sempre. */
export async function assertRecurso(k: RecursoKey, q: Tx | Db = db): Promise<void> {
  if (!(await getCaixaRecursos(q))[k]) throw new UserFacingError(recursoOffMessage(k));
}

/** Configurações › Caixa › "O que o caixa usa" (config.sistema). Valida, trava a linha e audita com de/para. */
export async function saveCaixaRecursos(input: CaixaRecursos, userId: string): Promise<void> {
  if (!isAssistentesMax(input.assistentesMax)) throw new UserFacingError("Use 1 ou 2 assistentes.");
  if (!isIntBetween(input.valeSenhaTentativas, 1, 20)) throw new UserFacingError("Use de 1 a 20 tentativas.");
  if (!isIntBetween(input.valeSenhaJanelaMin, 1, 120)) throw new UserFacingError("Use de 1 a 120 minutos.");
  const texto = typeof input.reciboTexto === "string" ? input.reciboTexto.trim() : "";
  if (!texto || texto.length > RECIBO_TEXTO_MAX) throw new UserFacingError("Escreva o texto do recibo.");
  const desde = input.pagarComissaoDesde || null;
  if (desde !== null && !isIsoDay(desde)) throw new UserFacingError("Use uma data válida.");
  const value: CaixaRecursos = { ...(Object.fromEntries(RECURSO_KEYS.map((k) => [k, !!input[k]])) as Record<RecursoKey, boolean>),
    assistentesMax: input.assistentesMax, valeSenhaTentativas: input.valeSenhaTentativas, valeSenhaJanelaMin: input.valeSenhaJanelaMin, reciboTexto: texto, pagarComissaoDesde: desde };
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(settings).where(eq(settings.key, KEY)).for("update");
    const before = readCaixaRecursos(row?.value);
    await tx.insert(settings).values({ key: KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "caixa_recursos", entity: "settings", entityId: KEY, data: { de: before, para: value } });
  });
}
