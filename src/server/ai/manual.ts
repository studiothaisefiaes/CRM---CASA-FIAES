import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, settings } from "../db/schema";
import { UserFacingError } from "../domain/errors";
import { AI_MANUAL_MAX, MANUAL_KEYS, emptyManual, manualLength, type ManualSections } from "@/lib/ai-manual";

/**
 * "O que a IA sabe sobre a Casa": o Manual da Casa em seções de skill (src/lib/ai-manual.ts), guardado em settings. Vai inteiro
 * no bloco fixo (em cache) de toda sugestão, por isso tem teto. Nunca dado de cliente aqui.
 */
export const AI_MANUAL_SETTING = "ia_manual_casa";

const tidy = (t: unknown) => String(t ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export async function getAiManual(): Promise<{ secoes: ManualSections; updatedAt: Date | null }> {
  const [r] = await db.select({ value: settings.value, updatedAt: settings.updatedAt }).from(settings).where(eq(settings.key, AI_MANUAL_SETTING));
  const saved = (r?.value as { secoes?: Record<string, unknown> } | undefined)?.secoes;
  if (!saved || typeof saved !== "object") return { secoes: emptyManual(), updatedAt: null };
  const secoes = emptyManual();
  for (const k of MANUAL_KEYS) if (typeof saved[k] === "string") secoes[k] = saved[k] as string;
  return { secoes, updatedAt: r!.updatedAt };
}

export async function saveAiManual(input: Partial<ManualSections>, userId: string | null): Promise<{ secoes: ManualSections; updatedAt: Date }> {
  const secoes = emptyManual();
  for (const k of MANUAL_KEYS) secoes[k] = tidy(input?.[k]);
  const len = manualLength(secoes);
  if (len > AI_MANUAL_MAX) throw new UserFacingError(`O manual tem ${len.toLocaleString("pt-BR")} caracteres; o máximo é ${AI_MANUAL_MAX.toLocaleString("pt-BR")}. Encurte para a IA continuar barata e rápida.`);
  const updatedAt = new Date();
  await db.insert(settings).values({ key: AI_MANUAL_SETTING, value: { secoes }, updatedAt }).onConflictDoUpdate({ target: settings.key, set: { value: { secoes }, updatedAt } });
  await db.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: AI_MANUAL_SETTING, data: { caracteres: len } });
  return { secoes, updatedAt };
}
