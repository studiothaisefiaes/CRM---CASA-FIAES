import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, lists } from "../db/schema";
import { mediaDir, save as saveMediaFile } from "../whatsapp/media";
import { MAX_MEDIA_BYTES, SendError, planMedia, sendFromCrm, sendMediaFromCrm, type Upload } from "./send";
import { UserFacingError } from "./errors";

export type QuickReplyAttachment = { path: string; mime: string; name: string; kind: "image" | "video" | "audio" | "document" };
export const FOLDER_MAX = 40;

export function quickReplyAttachment(meta: unknown): QuickReplyAttachment | null {
  const a = (meta as { attachment?: Partial<QuickReplyAttachment> } | null)?.attachment;
  return a && typeof a.path === "string" && typeof a.mime === "string" && typeof a.name === "string" && typeof a.kind === "string" ? (a as QuickReplyAttachment) : null;
}
const audit = (userId: string, action: string, id: string, data: Record<string, unknown>) => db.insert(auditLog).values({ userId, action, entity: "list", entityId: id, data });

async function replyRow(id: string) {
  const [r] = await db.select().from(lists).where(and(eq(lists.id, id), eq(lists.kind, "quick_reply")));
  if (!r) throw new UserFacingError("Essa resposta pronta não existe mais.");
  return r;
}
/* ---------- Universal ou só minha (pedido do dono, 15/10) ---------- */
/** Quem pede: `canShare` = gestão (Configurações), que cria universais, edita qualquer uma e transforma pessoal em universal. */
export type ReplyActor = { id: string; canShare: boolean };
export type ReplyScope = "universal" | "minha";
export type QuickReplyItem = { id: string; label: string; body: string | null; folder: string | null; attachment: { name: string; kind: string } | null; mine: boolean };
const LABEL_MAX = 60, BODY_MAX = 4000;

/** Dona da resposta pessoal (meta.ownerId); null = universal (todas usam). */
export function quickReplyOwnerId(meta: unknown): string | null {
  const o = (meta as { ownerId?: unknown } | null)?.ownerId;
  return typeof o === "string" && o ? o : null;
}
/** "/Retomar Contato" → "retomar-contato" (o atalho que se digita depois da barra). */
export const normalizeReplyLabel = (label: string) => label.trim().replace(/^\//, "").toLowerCase().replace(/\s+/g, "-");
function cleanInput(label: string, body: string) {
  const l = normalizeReplyLabel(label);
  if (!l) throw new UserFacingError("Escreva o atalho da resposta (o que vem depois da /).");
  if (l.length > LABEL_MAX) throw new UserFacingError(`Atalho muito longo (máximo ${LABEL_MAX} caracteres).`);
  const b = body.trim();
  if (!b) throw new UserFacingError("Escreva o texto da resposta pronta.");
  if (b.length > BODY_MAX) throw new UserFacingError(`Texto muito longo (máximo ${BODY_MAX} caracteres).`);
  return { l, b };
}
const isUniqueViolation = (e: unknown) => {
  const c = e as { code?: string; cause?: { code?: string } };
  return c?.code === "23505" || c?.cause?.code === "23505";
};
const taken = (l: string) => new UserFacingError(`Já existe uma resposta com o atalho /${l}. Escolha outro.`);

/** Cria a resposta pronta. Universal só pela gestão; a atendente cria as suas (só ela vê). */
export async function createQuickReply(input: { label: string; body: string; scope: ReplyScope; folder?: string | null }, actor: ReplyActor): Promise<{ id: string }> {
  if (input.scope === "universal" && !actor.canShare) throw new UserFacingError("Só a gestão cria respostas para todas. Salve como “Só minha”.");
  const { l, b } = cleanInput(input.label, input.body);
  const f = input.folder?.trim().replace(/\s+/g, " ") || null;
  if (f && f.length > FOLDER_MAX) throw new UserFacingError(`Nome da pasta muito longo (máximo ${FOLDER_MAX} caracteres).`);
  const [dup] = await db.select({ id: lists.id, active: lists.active, meta: lists.meta }).from(lists).where(and(eq(lists.kind, "quick_reply"), eq(lists.label, l)));
  // Uma universal desativada com o mesmo atalho volta à vida pela gestão (o comportamento antigo de Configurações). O resto é conflito.
  if (dup && !(actor.canShare && input.scope === "universal" && !dup.active && !quickReplyOwnerId(dup.meta))) throw taken(l);
  const meta = input.scope === "minha" ? { ownerId: actor.id } : null;
  let id: string;
  try {
    if (dup) {
      await db.update(lists).set({ body: b, active: true, category: f }).where(eq(lists.id, dup.id));
      id = dup.id;
    } else {
      const [{ max }] = (await db.execute(sql`select coalesce(max(position), -1)::int as max from lists where kind = 'quick_reply'`)).rows as { max: number }[];
      [{ id }] = await db.insert(lists).values({ kind: "quick_reply", label: l, body: b, position: max + 1, category: f, meta }).returning({ id: lists.id });
    }
  } catch (e) { if (isUniqueViolation(e)) throw taken(l); throw e; }
  await audit(actor.id, "adicionou", id, { kind: "quick_reply", label: l, escopo: input.scope });
  return { id };
}

/** Quem pode mexer: a dona (pessoal) ou a gestão. Pessoal de outra pessoa = "não existe" (nem confirma que existe). */
async function editableRow(id: string, actor: ReplyActor) {
  const row = await replyRow(id);
  const owner = quickReplyOwnerId(row.meta);
  if (owner && owner !== actor.id && !actor.canShare) throw new UserFacingError("Essa resposta pronta não existe mais.");
  if (!owner && !actor.canShare) throw new UserFacingError("Só a gestão muda as respostas de todas.");
  return row;
}

export async function updateQuickReply(id: string, input: { label: string; body: string; active?: boolean }, actor: ReplyActor): Promise<void> {
  const row = await editableRow(id, actor);
  const { l, b } = cleanInput(input.label, input.body);
  try {
    await db.update(lists).set({ label: l, body: b, active: input.active ?? row.active }).where(eq(lists.id, id));
  } catch (e) { if (isUniqueViolation(e)) throw taken(l); throw e; }
  await audit(actor.id, "editou", id, { label: l, active: input.active ?? row.active });
}

/** Gestão: a resposta pessoal passa a ser de todas (sai o dono). */
export async function makeQuickReplyUniversal(id: string, actor: ReplyActor): Promise<void> {
  if (!actor.canShare) throw new UserFacingError("Só a gestão transforma uma resposta em universal.");
  const row = await replyRow(id);
  const owner = quickReplyOwnerId(row.meta);
  if (!owner) return;
  const { ownerId: _drop, ...rest } = (row.meta as Record<string, unknown> | null) ?? {};
  await db.update(lists).set({ meta: Object.keys(rest).length ? rest : null }).where(eq(lists.id, id));
  await audit(actor.id, "tornou_universal", id, { label: row.label, dona: owner });
}

/** A lista do "/": as universais + as minhas (com o selo), ativas, por pasta e na ordem de Configurações. Sem quem vê: só as universais. */
export async function quickRepliesFor(userId: string | null): Promise<QuickReplyItem[]> {
  const rows = await db.select().from(lists).where(and(eq(lists.kind, "quick_reply"), eq(lists.active, true))).orderBy(asc(lists.position));
  return rows
    .filter((r) => { const o = quickReplyOwnerId(r.meta); return !o || o === userId; })
    .map((r) => { const a = quickReplyAttachment(r.meta); return { id: r.id, label: r.label, body: r.body, folder: r.category ?? null, attachment: a ? { name: a.name, kind: a.kind } : null, mine: !!userId && quickReplyOwnerId(r.meta) === userId }; })
    .sort((a, b) => (a.folder ?? "").localeCompare(b.folder ?? "", "pt-BR"));
}

const removeFile = (rel: string) => unlink(path.join(mediaDir(), rel)).catch(() => {});

/** Pasta da resposta pronta (agrupa a lista do "/" e a tela de Configurações). Vazio = sem pasta. */
export async function setQuickReplyFolder(id: string, folder: string | null, userId: string): Promise<void> {
  await replyRow(id);
  const f = folder?.trim().replace(/\s+/g, " ") || null;
  if (f && f.length > FOLDER_MAX) throw new UserFacingError(`Nome da pasta muito longo (máximo ${FOLDER_MAX} caracteres).`);
  await db.update(lists).set({ category: f }).where(eq(lists.id, id));
  await audit(userId, "editou", id, { pasta: f });
}

/** Anexo da resposta pronta: foto, PDF, vídeo ou áudio até 16 MB, tipo conferido pelos bytes. Troca o anterior (e apaga o arquivo velho). */
export async function attachToQuickReply(id: string, file: Upload, userId: string): Promise<QuickReplyAttachment> {
  const row = await replyRow(id);
  if (!file.data.length) throw new UserFacingError("O arquivo está vazio.");
  if (file.data.length > MAX_MEDIA_BYTES) throw new UserFacingError("O arquivo passa de 16 MB. Escolha um menor.");
  const plan = planMedia(file);
  if (!plan) throw new UserFacingError("Esse tipo de arquivo não pode ser enviado. Use foto, PDF, vídeo ou áudio.");
  const name = path.basename(file.name).replace(/[\u0000-\u001f\u007f"\\]/g, "").trim().slice(0, 120) || `arquivo.${plan.ext}`;
  const stored = await saveMediaFile(`resposta-${randomUUID()}.${plan.ext}`, file.data);
  const att: QuickReplyAttachment = { path: stored, mime: plan.mime, name, kind: plan.kind };
  const old = quickReplyAttachment(row.meta);
  await db.update(lists).set({ meta: { ...((row.meta as Record<string, unknown> | null) ?? {}), attachment: att } }).where(eq(lists.id, id));
  if (old) await removeFile(old.path);
  await audit(userId, "anexou", id, { arquivo: name, tipo: plan.mime });
  return att;
}

export async function detachFromQuickReply(id: string, userId: string): Promise<void> {
  const row = await replyRow(id);
  const old = quickReplyAttachment(row.meta);
  if (!old) return;
  const { attachment: _drop, ...rest } = (row.meta as Record<string, unknown> | null) ?? {};
  await db.update(lists).set({ meta: Object.keys(rest).length ? rest : null }).where(eq(lists.id, id));
  await removeFile(old.path);
  await audit(userId, "tirou_anexo", id, { arquivo: old.name });
}

export async function readQuickReplyFile(id: string): Promise<{ data: Buffer; att: QuickReplyAttachment } | null> {
  const [r] = await db.select({ meta: lists.meta }).from(lists).where(and(eq(lists.id, id), eq(lists.kind, "quick_reply")));
  const att = quickReplyAttachment(r?.meta);
  if (!att) return null;
  try { return { data: await readFile(path.join(mediaDir(), att.path)), att }; } catch { return null; }
}

/**
 * Resposta pronta com anexo pelo campo da conversa: primeiro o texto (assinado, como toda mensagem do CRM), depois o arquivo (sem legenda).
 * Texto vazio: só o arquivo. Se o texto não sair, o arquivo não vai; se o arquivo falhar depois do texto, avisa que só o texto saiu.
 * Áudio vai como mensagem de voz (o "áudio pré-gravado" do ChatGuru).
 */
export async function sendQuickReply(dealId: string, replyId: string, text: string, userId: string): Promise<{ textSent: boolean; fileSent: boolean }> {
  const owner = quickReplyOwnerId((await replyRow(replyId)).meta);
  if (owner && owner !== userId) throw new UserFacingError("Essa resposta pronta não existe mais.");
  const file = await readQuickReplyFile(replyId);
  if (!file) throw new UserFacingError("O anexo dessa resposta pronta não está mais disponível. Envie só o texto ou anexe de novo em Configurações.");
  const typed = text.trim();
  if (typed) await sendFromCrm(dealId, typed, userId);
  try {
    await sendMediaFromCrm(dealId, { name: file.att.name, mime: file.att.mime, data: file.data }, null, userId);
  } catch (e) {
    if (typed && e instanceof SendError) throw new SendError(`O texto saiu, mas o arquivo não: ${e.message.replace(/^Não foi possível enviar: /, "")}. Anexe e envie de novo.`);
    throw e;
  }
  return { textSent: !!typed, fileSent: true };
}
