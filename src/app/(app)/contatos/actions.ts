"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { BULK_MAX, bulkIgnoreContacts, bulkUnignoreContacts } from "@/server/domain/bulk";
import { unignoreContact } from "@/server/domain/deals";
import { UserFacingError } from "@/server/domain/errors";
import { startConversation } from "@/server/domain/start-conversation";
import { importClients, importLimitError, previewImportWithDb, type ImportPreview, type ImportReport } from "@/server/domain/import";
import { db } from "@/server/db";
import { auditLog } from "@/server/db/schema";
import { userErrorMessage } from "@/server/user-error";

async function readCsv(file: File) {
  const buf = Buffer.from(await file.arrayBuffer());
  const text = buf.toString("utf8");
  return text.includes("�") ? new TextDecoder("latin1").decode(buf) : text; // Excel antigo salva em Latin-1
}

/** Prévia: lê o arquivo e mostra o que seria importado. Não grava nada. */
export async function previewImportAction(form: FormData): Promise<{ ok: true; preview: ImportPreview } | { ok: false; error: string }> {
  try {
    await assertUser("gestor");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha um arquivo .csv." };
    const big = importLimitError(file.size); if (big) return { ok: false, error: big };
    const text = await readCsv(file);
    const tooMany = importLimitError(0, text); if (tooMany) return { ok: false, error: tooMany };
    const preview = await previewImportWithDb(text);
    if (preview.missingPhoneColumn) return { ok: false, error: "Não achei a coluna de telefone. Use um cabeçalho como \"Telefone\" ou \"Celular\"." };
    return { ok: true, preview };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "contatos", "Falha ao ler o arquivo.") }; }
}

export async function importClientsAction(form: FormData): Promise<{ ok: true; report: ImportReport } | { ok: false; error: string }> {
  try {
    const user = await assertUser("gestor");
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha um arquivo .csv." };
    const big = importLimitError(file.size); if (big) return { ok: false, error: big };
    const text = await readCsv(file);
    const tooMany = importLimitError(0, text); if (tooMany) return { ok: false, error: tooMany };
    const report = await importClients(text);
    if (report.missingPhoneColumn) return { ok: false, error: "Não achei a coluna de telefone. Use um cabeçalho como \"Telefone\" ou \"Celular\"." };
    await db.insert(auditLog).values({ userId: user.id, action: "importou", entity: "contacts", data: { ...report, invalid: report.invalid.length } });
    revalidatePath("/contatos");
    return { ok: true, report };
  } catch (e) { return { ok: false, error: userErrorMessage(e, "contatos", "Falha na importação.") }; }
}

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const uuid = z.string().uuid();
const refresh = (contactId?: string) => { revalidatePath("/contatos"); if (contactId) revalidatePath(`/contatos/${contactId}`); revalidatePath("/atendimento"); revalidatePath("/funil"); revalidatePath("/"); };
const safe = (e: unknown, fallback: string): { ok: false; error: string } => ({ ok: false, error: e instanceof UserFacingError ? e.message : e instanceof Error && e.message === "Sua sessão expirou. Entre de novo." ? e.message : fallback });

/**
 * "Iniciar conversa": garante um lead aberto para o contato (cria, ou leva ao que já existe) e abre a conversa com o campo de mensagem em foco.
 * Não envia nada. Em caso de erro devolve o texto para a tela; em caso de sucesso redireciona.
 */
export async function startConversationAction(contactId: string): Promise<ActionResult> {
  let dealId: string;
  try {
    const user = await assertUser();
    ({ dealId } = await startConversation(uuid.parse(contactId), user.id));
    refresh(contactId);
  } catch (e) { return safe(e, "Não foi possível iniciar a conversa. Tente de novo."); }
  redirect(`/atendimento/${dealId}?compose=1`);
}

/** "Voltar a ser cliente": o lead de "Não é cliente" volta para a fila (se não houver outro aberto) e o contato deixa de estar marcado. Individual: vale para qualquer contato. */
export async function unignoreContactAction(contactId: string): Promise<ActionResult<{ restored: boolean }>> {
  try {
    const user = await assertUser();
    const r = await unignoreContact(uuid.parse(contactId), user.id);
    refresh(contactId);
    return { ok: true, data: { restored: r.restored > 0 } };
  } catch (e) { return safe(e, "Não foi possível voltar a ser cliente. Tente de novo."); }
}

const ids = z.array(uuid).min(1, "Escolha pelo menos um contato.").max(BULK_MAX, `Escolha no máximo ${BULK_MAX} de cada vez.`);
/** "Não é cliente" em massa na lista de Contatos (até 100). A atendente só age no que é dela ou não tem dono; o resultado é o que o Desfazer restaura. */
export async function ignoreContactsAction(contactIds: string[]): Promise<ActionResult<{ ignored: number; skipped: number; dealIds: string[]; contactIds: string[] }>> {
  try {
    const user = await assertUser();
    const r = await bulkIgnoreContacts(ids.parse(contactIds), user);
    refresh();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível marcar. Tente de novo."); }
}

export async function undoIgnoreContactsAction(input: { dealIds: string[]; contactIds: string[] }): Promise<ActionResult<{ restored: number; conflicts: number; direct: number }>> {
  try {
    const user = await assertUser();
    const v = z.object({ dealIds: z.array(uuid).max(BULK_MAX), contactIds: z.array(uuid).max(BULK_MAX) }).parse(input);
    const r = await bulkUnignoreContacts(v, user);
    refresh();
    return { ok: true, data: { restored: r.restored, conflicts: r.conflicts.length, direct: r.direct } };
  } catch (e) { return safe(e, "Não foi possível desfazer. Tente de novo."); }
}
