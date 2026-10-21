"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertPerm } from "@/server/auth/session";
import { BULK_MAX, bulkIgnoreContacts, bulkUnignoreContacts } from "@/server/domain/bulk";
import { unignoreContact } from "@/server/domain/deals";
import { UserFacingError } from "@/server/domain/errors";
import { startConversation } from "@/server/domain/start-conversation";
import { createClient, DuplicatePhoneError, type NewClientInput } from "@/server/domain/new-client";
import { addPersonToNumber, type AddPersonInput } from "@/server/domain/people-on-number";
import { updateContactProfile, type ContactProfilePatch } from "@/server/domain/contact-profile";
import { saveAnswer } from "@/server/domain/fichas";
import { addClientPhoto, removeClientPhoto } from "@/server/domain/client-photos";
import { PHOTO_KINDS } from "@/lib/client-photos";
import { isUuid } from "@/lib/uuid";
import { mergeContacts, previewMerge, type MergePreview } from "@/server/domain/merge-contacts";
import { searchMergeTargets } from "@/server/queries/duplicate-suspects";
import { mergeSideView, type MergeSideView } from "@/lib/merge-view";
import { addTag, bulkTagContacts, removeTag } from "@/server/domain/tags";
import { remindReturn } from "@/server/domain/suggested-return";
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
    await assertPerm("config.sistema");
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
    const user = await assertPerm("config.sistema");
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
    const user = await assertPerm("contatos.ver");
    ({ dealId } = await startConversation(uuid.parse(contactId), user.id));
    refresh(contactId);
  } catch (e) { return safe(e, "Não foi possível iniciar a conversa. Tente de novo."); }
  redirect(`/atendimento/${dealId}?compose=1`);
}

/** "Mandar parabéns" do Hoje para quem não tem conversa aberta: o mesmo "Iniciar conversa" (não envia nada), com o parabéns já no campo. */
export async function birthdayConversationAction(contactId: string): Promise<ActionResult> {
  let dealId: string;
  try {
    const user = await assertPerm("contatos.ver");
    ({ dealId } = await startConversation(uuid.parse(contactId), user.id));
    refresh(contactId);
  } catch (e) { return safe(e, "Não foi possível abrir a conversa. Tente de novo."); }
  redirect(`/atendimento/${dealId}?compose=1&parabens=1`);
}

/** "Voltar a ser cliente": o lead de "Não é cliente" volta para a fila (se não houver outro aberto) e o contato deixa de estar marcado. Individual: vale para qualquer contato. */
export async function unignoreContactAction(contactId: string): Promise<ActionResult<{ restored: boolean }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const r = await unignoreContact(uuid.parse(contactId), user.id);
    refresh(contactId);
    return { ok: true, data: { restored: r.restored > 0 } };
  } catch (e) { return safe(e, "Não foi possível voltar a ser cliente. Tente de novo."); }
}

const ids = z.array(uuid).min(1, "Escolha pelo menos um contato.").max(BULK_MAX, `Escolha no máximo ${BULK_MAX} de cada vez.`);
/** "Não é cliente" em massa na lista de Contatos (até 100). A atendente só age no que é dela ou não tem dono; o resultado é o que o Desfazer restaura. */
export async function ignoreContactsAction(contactIds: string[]): Promise<ActionResult<{ ignored: number; skipped: number; dealIds: string[]; contactIds: string[] }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const r = await bulkIgnoreContacts(ids.parse(contactIds), user);
    refresh();
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível marcar. Tente de novo."); }
}

export async function undoIgnoreContactsAction(input: { dealIds: string[]; contactIds: string[] }): Promise<ActionResult<{ restored: number; conflicts: number; direct: number }>> {
  try {
    const user = await assertPerm("atendimento.fechar");
    const v = z.object({ dealIds: z.array(uuid).max(BULK_MAX), contactIds: z.array(uuid).max(BULK_MAX) }).parse(input);
    const r = await bulkUnignoreContacts(v, user);
    refresh();
    return { ok: true, data: { restored: r.restored, conflicts: r.conflicts.length, direct: r.direct } };
  } catch (e) { return safe(e, "Não foi possível desfazer. Tente de novo."); }
}

/** Edição na própria ficha (nome, e-mail, aniversário, anotações, avisos fixos, profissional preferida). Toda a equipe que vê Contatos. */
export async function updateContactProfileAction(contactId: string, patch: ContactProfilePatch): Promise<ActionResult<{ changed: string[] }>> {
  try {
    const user = await assertPerm("contatos.editar");
    const r = await updateContactProfile(uuid.parse(contactId), patch, user.id, user.perms);
    refresh(contactId);
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível salvar. Tente de novo."); }
}

/** Etiquetas na ficha (as mesmas da conversa: ficam na cliente). */
export async function addContactTagAction(contactId: string, name: string): Promise<ActionResult<{ id: string; name: string }>> {
  try {
    const user = await assertPerm("contatos.editar");
    const tag = await addTag(uuid.parse(contactId), z.string().max(200).parse(name), user.id);
    refresh(contactId);
    return { ok: true, data: tag };
  } catch (e) { return safe(e, "Não foi possível pôr a etiqueta. Tente de novo."); }
}
export async function removeContactTagAction(contactId: string, tagId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("contatos.editar");
    await removeTag(uuid.parse(contactId), uuid.parse(tagId), user.id);
    refresh(contactId);
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível tirar a etiqueta. Tente de novo."); }
}

/** "Lembrar" do Retorno sugerido: um combinado para quem tocou (nunca envia mensagem). */
export async function remindReturnAction(contactId: string, input: { dueAt?: string | null; dueOn?: string | null }): Promise<ActionResult<{ dueAt: string }>> {
  try {
    const user = await assertPerm("contatos.ver");
    const v = z.object({ dueAt: z.string().datetime({ offset: true }).nullable().optional(), dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(input);
    const r = await remindReturn(uuid.parse(contactId), { dueAt: v.dueAt ? new Date(v.dueAt) : null, dueOn: v.dueOn ?? null }, user.id);
    refresh(contactId);
    return { ok: true, data: { dueAt: r.dueAt.toISOString() } };
  } catch (e) { return safe(e, "Não foi possível criar o lembrete. Tente de novo."); }
}

/** "Agendar" da ficha: abre (ou reaproveita) a conversa e já abre a folha Agendar. Não envia nada. */
export async function scheduleFromContactAction(contactId: string): Promise<ActionResult> {
  let dealId: string;
  try {
    const user = await assertPerm("contatos.ver");
    ({ dealId } = await startConversation(uuid.parse(contactId), user.id));
    refresh(contactId);
  } catch (e) { return safe(e, "Não foi possível abrir a conversa para agendar. Tente de novo."); }
  redirect(`/atendimento/${dealId}?agendar=1`);
}

/** "Etiquetar" em massa na lista de Contatos (até 100). Toda a equipe que vê Contatos pode (as etiquetas são da equipe). */
export async function tagContactsAction(contactIds: string[], name: string): Promise<ActionResult<{ tag: string; tagged: number }>> {
  try {
    const user = await assertPerm("contatos.editar");
    const r = await bulkTagContacts(ids.parse(contactIds), z.string().max(200).parse(name), user.id);
    refresh();
    return { ok: true, data: { tag: r.tag.name, tagged: r.tagged } };
  } catch (e) { return safe(e, "Não foi possível etiquetar. Tente de novo."); }
}

/** "Nova cliente": nome e telefone obrigatórios; e-mail e aniversário opcionais. Telefone repetido volta com a ficha que já existe (`existing`). */
export async function createClientAction(input: NewClientInput): Promise<ActionResult<{ contactId: string }> | { ok: false; error: string; existing: { id: string; name: string | null } }> {
  try {
    const user = await assertPerm("contatos.editar");
    const r = await createClient(input, user.id);
    refresh(r.contactId);
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof DuplicatePhoneError) return { ok: false, error: e.message, existing: e.existing };
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Confira os campos." };
    return safe(e, "Não foi possível cadastrar a cliente. Tente de novo.");
  }
}

/**
 * "+ Adicionar pessoa" (Pessoas neste número: ficha, painel Cliente da conversa e Nova cliente com telefone que já existe). Nome obrigatório;
 * relação, e-mail, CPF e aniversário opcionais. A conversa continua a do titular do número; a pessoa ganha ficha própria.
 */
export async function addPersonAction(input: AddPersonInput): Promise<ActionResult<{ contactId: string }>> {
  try {
    const user = await assertPerm("contatos.editar");
    const r = await addPersonToNumber(input, user.id);
    refresh(r.contactId);
    refresh(input.contactId);
    return { ok: true, data: r };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues[0]?.message ?? "Confira os campos." };
    return safe(e, "Não foi possível adicionar a pessoa. Tente de novo.");
  }
}

/** As perguntas da Casa nascem na migration com id md5 (não é UUID v4): o `.uuid()` estrito do zod recusaria. */
const anyUuid = z.string().refine(isUuid, "Pedido inválido.");
const answerSchema = z.object({ contactId: uuid, questionId: anyUuid, visitId: uuid.nullish(), value: z.union([z.string().max(10_000), z.array(z.string().max(500)).max(100), z.null()]) });
/** Responde (ou troca, ou apaga com vazio) uma pergunta das fichas: anamnese e campos da cliente, consultoria de uma visita. Só quem tem fichas.responder. */
export async function saveFichaAnswerAction(input: { contactId: string; questionId: string; visitId?: string | null; value: string | string[] | null }): Promise<ActionResult> {
  try {
    const user = await assertPerm("fichas.responder");
    const v = answerSchema.parse(input);
    await saveAnswer({ contactId: v.contactId, questionId: v.questionId, ...(v.visitId ? { visitId: v.visitId } : {}), value: v.value }, user.id);
    refresh(v.contactId);
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível salvar a resposta. Tente de novo."); }
}

/** Foto de antes ou depois (câmera ou arquivo, sem edição). Campos: contactId, visitId (opcional), kind e photo. Só quem tem fotos.adicionar. */
export async function addClientPhotoAction(form: FormData): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await assertPerm("fotos.adicionar");
    const v = z.object({ contactId: uuid, visitId: uuid.nullable(), kind: z.enum(PHOTO_KINDS) }).parse({
      contactId: form.get("contactId"), visitId: form.get("visitId") || null, kind: form.get("kind"),
    });
    const file = form.get("photo");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Escolha uma foto." };
    const r = await addClientPhoto({ ...v, data: Buffer.from(await file.arrayBuffer()) }, user.id);
    refresh(v.contactId);
    return { ok: true, data: r };
  } catch (e) { return safe(e, "Não foi possível guardar a foto. Tente de novo."); }
}

/** Tira a foto da ficha (some da tela; o arquivo fica guardado). Só quem tem fotos.apagar. */
export async function removeClientPhotoAction(photoId: string): Promise<ActionResult> {
  try {
    const user = await assertPerm("fotos.apagar");
    await removeClientPhoto(uuid.parse(photoId), user.id);
    refresh();
    revalidatePath("/contatos/[id]", "page");
    return { ok: true };
  } catch (e) { return safe(e, "Não foi possível apagar a foto. Tente de novo."); }
}

/** Passo "Com quem?": busca por nome ou telefone. Devolve só nome e o final do número (o número inteiro e o CPF nunca vão para a tela). */
export async function searchMergeTargetsAction(exceptId: string, q: string): Promise<ActionResult<{ id: string; name: string | null; hint: string }[]>> {
  try {
    await assertPerm("contatos.unir");
    return { ok: true, data: await searchMergeTargets(uuid.parse(exceptId), String(q).slice(0, 80)) };
  } catch (e) { return safe(e, "Não foi possível buscar. Tente de novo."); }
}

/** Passos 2 e 3: a prévia nas duas ordens (quem fica / quem sai), para sugerir qual cadastro fica e mostrar o que vai junto. */
export type MergeViews = { a: { side: MergeSideView; ifDropped: MergePreview["moving"]; blockers: string[] }; b: { side: MergeSideView; ifDropped: MergePreview["moving"]; blockers: string[] } };
export async function previewMergeAction(aId: string, bId: string): Promise<ActionResult<MergeViews>> {
  try {
    await assertPerm("contatos.unir");
    const [a, b] = [uuid.parse(aId), uuid.parse(bId)];
    // pA: A fica e B sai (o que vai junto é o de B); pB: B fica e A sai.
    const [pA, pB] = await Promise.all([previewMerge(a, b), previewMerge(b, a)]);
    return { ok: true, data: { a: { side: mergeSideView(pA.keep), ifDropped: pB.moving, blockers: pB.blockers }, b: { side: mergeSideView(pB.keep), ifDropped: pA.moving, blockers: pA.blockers } } };
  } catch (e) { return safe(e, "Não foi possível conferir os cadastros. Tente de novo."); }
}

/** Une dois cadastros. Pede a permissão (e a função ligada) e o "Estou ciente" (não dá para desfazer). */
export async function mergeContactsAction(keepId: string, dropId: string, ciente: boolean): Promise<ActionResult<{ keptId: string }>> {
  try {
    const user = await assertPerm("contatos.unir");
    if (ciente !== true) return { ok: false, error: "Marque “Estou ciente” para unir: não dá para desfazer." };
    const [keep, drop] = [uuid.parse(keepId), uuid.parse(dropId)];
    await mergeContacts({ keepId: keep, dropId: drop }, user.id);
    refresh(keep);
    return { ok: true, data: { keptId: keep } };
  } catch (e) { return safe(e, "Não foi possível unir os cadastros. Tente de novo."); }
}
