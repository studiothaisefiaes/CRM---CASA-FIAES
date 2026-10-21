import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { userPreferences } from "../db/schema";
import { UserFacingError } from "./errors";
import { normalizePrefs, prefsSchema, type AgendaPrefs } from "@/lib/agenda-view-prefs";

const AGENDA = "agenda";

/** As visões da Agenda da pessoa (Personalizar). Sem nada gravado, ou gravado numa versão antiga: o que der para aproveitar + a Padrão. */
export async function getAgendaPrefs(userId: string): Promise<AgendaPrefs> {
  const [r] = await db.select({ value: userPreferences.value }).from(userPreferences).where(and(eq(userPreferences.userId, userId), eq(userPreferences.key, AGENDA)));
  return normalizePrefs(r?.value);
}

/** Grava as visões da pessoa (substitui). Só o que passa na validação; a pessoa é sempre a da sessão (quem chama garante). */
export async function saveAgendaPrefs(userId: string, raw: unknown): Promise<AgendaPrefs> {
  const parsed = prefsSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError("Não deu para salvar a personalização. Tente de novo.");
  const value = normalizePrefs(parsed.data);
  await db.insert(userPreferences).values({ userId, key: AGENDA, value })
    .onConflictDoUpdate({ target: [userPreferences.userId, userPreferences.key], set: { value, updatedAt: new Date() } });
  return value;
}
