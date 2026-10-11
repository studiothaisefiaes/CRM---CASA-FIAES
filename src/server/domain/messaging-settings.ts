import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { auditLog, lists, settings } from "../db/schema";
import { DEFAULT_ENVIO_TETO_HORA } from "./outbox";

const audit = (userId: string, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}) =>
  db.insert(auditLog).values({ userId, action, entity, entityId, data });
const put = (key: string, value: unknown) =>
  db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
const get = async (key: string) => (await db.select({ value: settings.value }).from(settings).where(eq(settings.key, key)))[0]?.value;

/* ---------- Resposta fora do horário ---------- */
export const AUTO_REPLY_MAX_CHARS = 500;
export const autoReplySchema = z.object({
  enabled: z.boolean(),
  text: z.string().trim().max(AUTO_REPLY_MAX_CHARS, `O texto passou de ${AUTO_REPLY_MAX_CHARS} caracteres.`),
}).refine((v) => !v.enabled || v.text.length >= 3, { message: "Escreva o texto antes de ligar a resposta fora do horário.", path: ["text"] });
export type AutoReplyConfig = z.infer<typeof autoReplySchema>;

export async function getAutoReply(): Promise<AutoReplyConfig> {
  const v = (await get("auto_resposta")) as Partial<AutoReplyConfig> | undefined;
  return { enabled: !!v?.enabled, text: v?.text ?? "" };
}
/** Salva o texto e o liga/desliga. A confirmação "isto envia mensagens reais" é da tela; aqui fica a auditoria de quem ligou. */
export async function saveAutoReply(input: unknown, userId: string) {
  const v = autoReplySchema.parse(input);
  const before = await getAutoReply();
  await put("auto_resposta", v);
  await audit(userId, v.enabled !== before.enabled ? (v.enabled ? "ligou" : "desligou") : "editou", "settings", "auto_resposta", { enabled: v.enabled, text: v.text });
}

/* ---------- Teto de envios por hora ---------- */
export const sendCapSchema = z.number({ error: "Informe um número de 1 a 200." }).int("Informe um número inteiro.").min(1, "O mínimo é 1 por hora.").max(200, "O máximo é 200 por hora.");
export async function getSendCap(): Promise<number> {
  const n = Number(await get("envio_teto_hora"));
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_ENVIO_TETO_HORA;
}
export async function saveSendCap(input: unknown, userId: string) {
  const v = sendCapSchema.parse(input);
  await put("envio_teto_hora", v);
  await audit(userId, "editou", "settings", "envio_teto_hora", { value: v });
}

/* ---------- Retenção de mídia ---------- */
export const RETENTION_OPTIONS = [6, 12, 24, "nunca"] as const;
export const DEFAULT_RETENTION_MONTHS = 12;
export const retentionSchema = z.union([z.literal(6), z.literal(12), z.literal(24), z.literal("nunca")], { error: "Escolha 6, 12 ou 24 meses, ou nunca." });
/** Meses de guarda da mídia (a T23 apaga do disco o que passa disso); `null` = nunca apagar. */
export async function getMediaRetentionMonths(): Promise<number | null> {
  const v = await get("retencao_midia_meses");
  if (v === "nunca") return null;
  return v === 6 || v === 12 || v === 24 ? v : DEFAULT_RETENTION_MONTHS;
}
export async function saveMediaRetention(input: unknown, userId: string) {
  const v = retentionSchema.parse(input);
  await put("retencao_midia_meses", v);
  await audit(userId, "editou", "settings", "retencao_midia_meses", { value: v });
}

/* ---------- Ciclo de retorno do serviço ---------- */
export const cycleDaysSchema = z.number({ error: "Informe os dias, de 1 a 365, ou deixe vazio." }).int("Informe um número inteiro de dias.").min(0).max(365, "O máximo é 365 dias.").nullable();
/** 0 ou vazio = não lembrar. */
export async function saveServiceCycleDays(id: string, input: unknown, userId: string) {
  const parsed = cycleDaysSchema.parse(input);
  const v = parsed ? parsed : null;
  const [row] = await db.update(lists).set({ cycleDays: v }).where(and(eq(lists.id, z.string().uuid().parse(id)), eq(lists.kind, "service"))).returning({ label: lists.label });
  if (!row) throw new Error("Serviço não encontrado.");
  await audit(userId, "editou", "list", id, { label: row.label, cycleDays: v });
}
