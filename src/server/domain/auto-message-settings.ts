import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { and } from "drizzle-orm";
import { auditLog, lists, settings, type Deal } from "../db/schema";
import { createQuickReply, updateQuickReply } from "./quick-replies";

/** Mensagens automáticas do Lote 4 (além da "fora do horário"). Todas nascem DESLIGADAS; ligar pede a confirmação de envio real na tela. */
export const AUTO_MESSAGE_KINDS = ["boas_vindas", "ausencia", "encerramento"] as const;
export type AutoMessageKind = (typeof AUTO_MESSAGE_KINDS)[number];
/** `source` do item na fila de envio ("msg_auto:boas_vindas"…): reconferido na hora de enviar. */
export const AUTO_MESSAGE_SOURCE = "msg_auto:";
const KEY: Record<AutoMessageKind, string> = { boas_vindas: "msg_boas_vindas", ausencia: "msg_ausencia", encerramento: "msg_encerramento" };
export const AUTO_MESSAGE_MAX_CHARS = 500;
/** Item que ficou mais que isso na fila perdeu a hora (a Casa fechou no meio, o worker parou). */
export const AUTO_MESSAGE_MAX_QUEUE_MS = 30 * 60_000;

export const autoMessageSchema = z.object({
  enabled: z.boolean(),
  text: z.string().trim().max(AUTO_MESSAGE_MAX_CHARS, `O texto passou de ${AUTO_MESSAGE_MAX_CHARS} caracteres.`),
}).refine((v) => !v.enabled || v.text.length >= 3, { message: "Escreva o texto antes de ligar.", path: ["text"] });
export type AutoMessageConfig = z.infer<typeof autoMessageSchema>;

/** Sem a chave em `settings` = desligada e sem texto. */
export async function getAutoMessage(kind: AutoMessageKind): Promise<AutoMessageConfig> {
  const [r] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, KEY[kind]));
  const v = r?.value as Partial<AutoMessageConfig> | undefined;
  return { enabled: !!v?.enabled, text: v?.text ?? "" };
}

/** Salva o texto e liga/desliga. A confirmação "isto envia mensagens reais" é da tela; aqui fica a auditoria de quem ligou. */
export async function saveAutoMessage(kind: AutoMessageKind, input: unknown, userId: string): Promise<void> {
  const v = autoMessageSchema.parse(input);
  const before = await getAutoMessage(kind);
  await db.insert(settings).values({ key: KEY[kind], value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await db.insert(auditLog).values({ userId, action: v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", entity: "settings", entityId: KEY[kind], data: { enabled: v.enabled, text: v.text } });
}

/** Na hora de enviar: o motivo para cancelar (desligada, velha, a conversa mudou) ou null para seguir. */
export async function autoMessageCancelReason(source: string, meta: { awaiting?: string },
  deal: Pick<Deal, "awaitingReplySince" | "conversationArchivedAt" | "closedAt" | "lastInboundAt">, createdAt: Date, now: Date): Promise<string | null> {
  const kind = source.slice(AUTO_MESSAGE_SOURCE.length) as AutoMessageKind;
  if (!AUTO_MESSAGE_KINDS.includes(kind)) return "Mensagem automática desconhecida.";
  if (!(await getAutoMessage(kind)).enabled) return "A mensagem automática foi desligada.";
  if (now.getTime() - createdAt.getTime() > AUTO_MESSAGE_MAX_QUEUE_MS) return "A mensagem automática ficou mais de 30 minutos na fila.";
  if (kind === "encerramento") {
    if (!deal.conversationArchivedAt && !deal.closedAt) return "A conversa foi reaberta.";
    if (deal.lastInboundAt && deal.lastInboundAt.getTime() > createdAt.getTime()) return "A cliente escreveu depois de resolver.";
    return null;
  }
  if (!deal.awaitingReplySince || deal.awaitingReplySince.toISOString() !== meta.awaiting) return "A cliente já foi atendida ou a espera mudou.";
  return null;
}

/** O atalho da resposta pronta de cada mensagem automática: "/auto-boas-vindas", "/auto-ausencia", "/auto-encerramento". */
export const AUTO_REPLY_SHORTCUT: Record<AutoMessageKind, string> = { boas_vindas: "auto-boas-vindas", ausencia: "auto-ausencia", encerramento: "auto-encerramento" };

/**
 * "Só consulta" (20/10, pedido da recepção): o texto da mensagem automática vira uma resposta pronta para todas (digitar "/" na conversa) em vez de
 * sair sozinho. A mensagem automática fica DESLIGADA (nada sai sem a atendente); o texto continua guardado nela. Idempotente: de novo, atualiza.
 */
export async function saveAutoMessageAsReply(kind: AutoMessageKind, text: string, userId: string): Promise<{ shortcut: string }> {
  const v = autoMessageSchema.parse({ enabled: false, text });
  if (v.text.length < 3) throw new Error("Escreva o texto antes de deixar como resposta pronta.");
  await db.insert(settings).values({ key: KEY[kind], value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  const shortcut = AUTO_REPLY_SHORTCUT[kind];
  const actor = { id: userId, canShare: true };
  const [row] = await db.select({ id: lists.id }).from(lists).where(and(eq(lists.kind, "quick_reply"), eq(lists.label, shortcut)));
  if (row) await updateQuickReply(row.id, { label: shortcut, body: v.text, active: true }, actor);
  else await createQuickReply({ label: shortcut, body: v.text, scope: "universal", folder: "Mensagens automáticas" }, actor);
  await db.insert(auditLog).values({ userId, action: "deixou_como_resposta_pronta", entity: "settings", entityId: KEY[kind], data: { atalho: shortcut } });
  return { shortcut };
}
