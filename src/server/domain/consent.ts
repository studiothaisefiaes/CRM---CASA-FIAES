import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, contacts, PAUSE_FOREVER } from "../db/schema";
import { CONSENT_KEYS, PAUSED_REASON, pauseOf, type Consent, type ConsentKey } from "@/lib/consent";
import { assertFuncaoLigada } from "./funcoes";
import { UserFacingError } from "./errors";
import { emit } from "./events";

export type { Consent };
const COLUMN = { whatsapp: "consentWhatsapp", ai: "consentAi", cpfNota: "consentCpfNota" } as const;

/**
 * Motivo para NÃO mandar mensagem automática a esta cliente, ou null. Vale para tudo que é automático para ela (regras, menu, boas-vindas,
 * ausência, fora do horário, resolver, lembrete, depois do atendimento, massa); a mensagem programada à mão não passa por aqui.
 * Vale mesmo com a função desligada: quem pediu pausa nunca recebe.
 */
export function automationBlockReason(contact: { automationsPausedUntil: Date | number | null }, now: Date): string | null {
  return pauseOf(contact.automationsPausedUntil, now) ? PAUSED_REASON : null;
}

/** Grava só o que mudou (null = não perguntado). Audita de/para. Exige a função "O que a cliente aceita" ligada. */
export async function saveConsent(contactId: string, patch: Partial<Consent>, userId: string): Promise<void> {
  await assertFuncaoLigada("consentimento");
  const keys = CONSENT_KEYS.filter((k) => patch[k] !== undefined);
  for (const k of keys) if (patch[k] !== null && typeof patch[k] !== "boolean") throw new UserFacingError("Resposta inválida.");
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!c) throw new UserFacingError("Cliente não encontrada.");
    const changed: ConsentKey[] = keys.filter((k) => c[COLUMN[k]] !== patch[k]);
    if (!changed.length) return;
    const set: Partial<typeof contacts.$inferInsert> = { consentAt: new Date(), consentBy: userId };
    const de: Partial<Consent> = {}, para: Partial<Consent> = {};
    for (const k of changed) { set[COLUMN[k]] = patch[k] as boolean | null; de[k] = c[COLUMN[k]]; para[k] = patch[k] as boolean | null; }
    await tx.update(contacts).set(set).where(eq(contacts.id, contactId));
    await tx.insert(auditLog).values({ userId, action: "consentimento", entity: "contact", entityId: contactId, data: { de, para } });
  });
  await emit("lead_atualizado", {});
}

/** `until`: uma data (pausada até lá), "sempre" (até alguém religar) ou null (religa). Exige a função "Automáticas pausadas" ligada. */
export async function setAutomationsPaused(contactId: string, until: Date | "sempre" | null, userId: string): Promise<void> {
  await assertFuncaoLigada("pausa_automaticas");
  if (until instanceof Date && !Number.isFinite(until.getTime())) throw new UserFacingError("Data inválida.");
  await db.transaction(async (tx) => {
    const [c] = await tx.select({ id: contacts.id, until: contacts.automationsPausedUntil }).from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!c) throw new UserFacingError("Cliente não encontrada.");
    await tx.update(contacts).set({ automationsPausedUntil: until === "sempre" ? PAUSE_FOREVER : until }).where(eq(contacts.id, contactId));
    const was = pauseOf(c.until, new Date(0));
    const before = was === null ? null : was === "sempre" ? "sempre" : was.toISOString();
    await tx.insert(auditLog).values({ userId, action: "pausa_automaticas", entity: "contact", entityId: contactId, data: { de: before, para: until instanceof Date ? until.toISOString() : until } });
  });
  await emit("lead_atualizado", {});
}
