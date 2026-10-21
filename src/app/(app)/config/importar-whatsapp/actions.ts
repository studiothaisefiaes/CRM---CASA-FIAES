"use server";
import { revalidatePath } from "next/cache";
import { assertAnyPerm } from "@/server/auth/session";
import { userErrorMessage } from "@/server/user-error";
import { isUuid } from "@/lib/uuid";
import { applyWhatsappImport, discardUpload, previewWhatsappImport, searchClientsForImport, type ZapPreview, type ZapReport } from "@/server/domain/whatsapp-import";

type R<T> = { ok: true; data: T } | { ok: false; error: string };
type Opts = { casa?: string | null; contactId?: string | null; fixed?: boolean };
const PERMS = ["config.sistema", "contatos.importar"] as const;
const opts = (o: Opts) => {
  const id = o.contactId && isUuid(o.contactId) ? o.contactId : null;
  return { casa: typeof o.casa === "string" ? o.casa.slice(0, 200) : null, contactId: o.fixed ? null : id, fixedContactId: o.fixed ? id : null };
};

/** Refaz a prévia com outra escolha (quem é a Casa, qual cliente). Nada é gravado. */
export async function previewZapAction(token: string, o: Opts): Promise<R<ZapPreview>> {
  try { const u = await assertAnyPerm(...PERMS); return { ok: true, data: await previewWhatsappImport(String(token), u.id, opts(o)) }; }
  catch (e) { return { ok: false, error: userErrorMessage(e, "importar-whatsapp") }; }
}

/** Grava as mensagens antigas na conversa da cliente (sem enviar nada) e apaga o arquivo temporário. */
export async function applyZapAction(token: string, o: Opts): Promise<R<ZapReport>> {
  try {
    const u = await assertAnyPerm(...PERMS);
    const r = await applyWhatsappImport(String(token), u.id, opts(o));
    revalidatePath(`/contatos/${r.contactId}`);
    return { ok: true, data: r };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "importar-whatsapp") }; }
}

export async function discardZapAction(token: string): Promise<void> {
  await assertAnyPerm(...PERMS);
  await discardUpload(String(token));
}

export async function searchZapClientsAction(q: string): Promise<{ id: string; name: string | null; phone: string }[]> {
  await assertAnyPerm(...PERMS);
  return searchClientsForImport(String(q).slice(0, 80));
}
