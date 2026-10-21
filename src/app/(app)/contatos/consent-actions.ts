"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { saveConsent } from "@/server/domain/consent";

type R = { ok: true } | { ok: false; error: string };
const answer = z.boolean().nullable();
const schema = z.object({ contactId: z.string().uuid(), patch: z.object({ whatsapp: answer, ai: answer, cpfNota: answer }).partial().strict() });

/** "O que ela aceita" na ficha: Sim, Não ou não perguntado (null). Exige "Mudar o que a cliente aceita" no servidor. */
export async function saveConsentAction(contactId: string, patch: unknown): Promise<R> {
  try {
    const u = await assertPerm("cliente.consentimento");
    const p = schema.parse({ contactId, patch });
    await saveConsent(p.contactId, p.patch, u.id);
    revalidatePath(`/contatos/${p.contactId}`);
    return { ok: true };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "consentimento") }; }
}
