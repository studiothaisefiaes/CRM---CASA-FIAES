import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { UserFacingError } from "./errors";
import { REMOVED_SUFFIX } from "@/server/whatsapp/channel-removed";
import { z } from "zod";
import { db, type Tx } from "../db";
import { automations, automationVersions, auditLog, channels, libraryFiles, lists, settings, stages, users } from "../db/schema";
import { funcaoParam } from "./funcoes";
import { automationInputSchema, type AutomationInput } from "../rules/types";
import { sendsMessages } from "../rules/templates";
import { whatsapp } from "../whatsapp/evolution";
import { getLembreteD1 } from "./client-link/settings";
import { startQuietIfPaired } from "./quiet";

const audit = (userId: string, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}) =>
  db.insert(auditLog).values({ userId, action, entity, entityId, data });

/* ---------- Etapas ---------- */
export const stageEditSchema = z.object({
  name: z.string().trim().min(2).max(40),
  slaMinutes: z.number().int().min(1).max(1440).nullable(),
  staleDays: z.number().int().min(1).max(90).nullable(),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export async function updateStage(id: string, input: z.input<typeof stageEditSchema>, userId: string) {
  const v = stageEditSchema.parse(input);
  await db.update(stages).set(v).where(eq(stages.id, id));
  await audit(userId, "editou", "stage", id, v);
}
export async function moveStage(id: string, dir: -1 | 1, userId: string) {
  const all = await db.select().from(stages).orderBy(asc(stages.position));
  const i = all.findIndex((s) => s.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= all.length) return;
  // Lote 4: a primeira etapa de cada tipo é a que o sistema usa (stageByKind); uma extra do mesmo tipo nunca passa à frente dela.
  if (all[i].kind === all[j].kind && all[i].active && all[j].active)
    throw new UserFacingError("A primeira etapa de cada tipo é a que o sistema usa: uma etapa extra do mesmo tipo fica depois dela.");
  await db.transaction(async (tx) => {
    await tx.update(stages).set({ position: all[j].position }).where(eq(stages.id, all[i].id));
    await tx.update(stages).set({ position: all[i].position }).where(eq(stages.id, all[j].id));
  });
  await audit(userId, "reordenou", "stage", id, { dir });
}

/* ---------- Horário de atendimento ---------- */
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");
export const hoursSchema = z.record(z.enum(["0", "1", "2", "3", "4", "5", "6"]), z.union([z.tuple([hhmm, hhmm]), z.null()]))
  .refine((h) => Object.values(h).every((w) => !w || w[0] < w[1]), "O horário de abrir precisa ser antes do de fechar");
export async function saveBusinessHours(input: unknown, userId: string) {
  const v = hoursSchema.parse(input);
  await db.insert(settings).values({ key: "business_hours", value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await audit(userId, "editou", "settings", "business_hours", v as Record<string, unknown>);
}

/* ---------- Automações (com versões) ---------- */
type AutoShape = { enabled: boolean; trigger: unknown; actions: unknown };
const actionTypes = (a: AutoShape) => (Array.isArray(a.actions) ? (a.actions as { type?: string }[]).map((x) => x.type) : []);
const isAgendamento = (a: AutoShape) => (a.trigger as { type?: string } | null)?.type === "agendamento_em_horas";

/**
 * O lembrete da véspera (Configurações › Mensagens, `lembrete_d1`) é a fonte única (Plano 5). Ligado, nenhuma automação de agendamento
 * que manda mensagem ou enquete liga: a cliente receberia duas. A trava enquete × lembrete entre automações saiu com as duas automações do seed.
 */
async function assertNoReminderConflict(tx: Tx, v: AutoShape) {
  const mine = actionTypes(v);
  if (!v.enabled || !isAgendamento(v) || !(mine.includes("enviar_enquete_confirmacao") || mine.includes("enviar_mensagem"))) return;
  await tx.execute(sql`select pg_advisory_xact_lock(7120013)`); // duas telas salvando ao mesmo tempo não furam a regra (a mesma de saveLembreteD1)
  if ((await getLembreteD1(tx)).enabled) throw new Error("Desligue o lembrete do horário (no fim desta tela) antes de ligar este.");
}

/** Ligar (ou salvar ligada) uma automação que manda mensagem à cliente pede a confirmação de envio real vinda da tela (send-confirm). */
const SEND_CONFIRM_ERROR = "Confirme o envio real para ligar.";
function assertSendConfirmed(enabled: boolean, actions: readonly { type: string }[], opts?: { confirmouEnvio?: boolean }) {
  if (enabled && sendsMessages(actions) && opts?.confirmouEnvio !== true) throw new UserFacingError(SEND_CONFIRM_ERROR);
}

/**
 * As ações que dependem de outras telas (Fase B, Task 7): o arquivo precisa estar na Biblioteca e o atraso não passa do número
 * "Atraso máximo de uma ação" (Configurações › Recursos › Regras por acontecimento).
 */
async function assertActionsValid(actions: AutomationInput["actions"]) {
  const maxDelay = await funcaoParam("regras_acontecimento", "atraso_max_min");
  for (const a of actions) {
    if ((a.type === "enviar_mensagem" || a.type === "enviar_arquivo") && (a.delayMinutes ?? 0) > maxDelay)
      throw new UserFacingError(`O atraso máximo de uma ação é ${maxDelay} min (Configurações › Recursos).`);
  }
  const fileIds = [...new Set(actions.flatMap((a) => (a.type === "enviar_arquivo" ? [a.fileId] : [])))];
  if (fileIds.length) {
    const found = await db.select({ id: libraryFiles.id }).from(libraryFiles).where(and(inArray(libraryFiles.id, fileIds), isNull(libraryFiles.deletedAt)));
    if (found.length !== fileIds.length) throw new UserFacingError("Esse arquivo saiu da Biblioteca. Escolha outro.");
  }
}

export async function saveAutomation(id: string | null, input: AutomationInput, userId: string, opts?: { confirmouEnvio?: boolean }) {
  const v = automationInputSchema.parse(input);
  assertSendConfirmed(v.enabled, v.actions, opts);
  await assertActionsValid(v.actions);
  return db.transaction(async (tx) => {
    await assertNoReminderConflict(tx, v);
    if (!id) {
      const [a] = await tx.insert(automations).values({ ...v, updatedBy: userId }).returning();
      await tx.insert(automationVersions).values({ automationId: a.id, version: 1, snapshot: v, userId });
      await tx.insert(auditLog).values({ userId, action: "criou", entity: "automation", entityId: a.id, data: { enabled: v.enabled, envia: sendsMessages(v.actions) } });
      return a.id;
    }
    const [cur] = await tx.select().from(automations).where(eq(automations.id, id));
    if (!cur) throw new Error("Automação não encontrada");
    const next = cur.version + 1;
    await tx.update(automations).set({ ...v, version: next, updatedBy: userId, updatedAt: new Date() }).where(eq(automations.id, id));
    await tx.insert(automationVersions).values({ automationId: id, version: next, snapshot: v, userId });
    // Quem salvou uma automação ligada que manda mensagem fica registrado (com a confirmação "envio real" da tela, conferida acima).
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "automation", entityId: id, data: { enabled: v.enabled, envia: sendsMessages(v.actions), versao: next } });
    return id;
  });
}
export async function toggleAutomation(id: string, enabled: boolean, userId: string, opts?: { confirmouEnvio?: boolean }) {
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(automations).where(eq(automations.id, id)).for("update");
    if (cur) assertSendConfirmed(enabled, (cur.actions ?? []) as { type: string }[], opts);
    if (cur) await assertNoReminderConflict(tx, { ...cur, enabled });
    await tx.update(automations).set({ enabled, updatedBy: userId, updatedAt: new Date() }).where(eq(automations.id, id));
  });
  const [after] = await db.select({ actions: automations.actions }).from(automations).where(eq(automations.id, id));
  await audit(userId, enabled ? "ligou" : "desligou", "automation", id, { envia: sendsMessages((after?.actions ?? []) as { type: string }[]) });
}
export async function restoreAutomation(id: string, version: number, userId: string) {
  const [v] = await db.select().from(automationVersions).where(and(eq(automationVersions.automationId, id), eq(automationVersions.version, version)));
  if (!v) throw new Error("Versão não encontrada");
  const snap = automationInputSchema.parse(v.snapshot);
  // Restaurar nunca liga envio por trás: com ação de mensagem, volta desligada (a gestão liga depois, com o aviso de envio real).
  const disabled = sendsMessages(snap.actions);
  await saveAutomation(id, disabled ? { ...snap, enabled: false } : snap, userId);
  return { id, disabled };
}
export async function deleteAutomation(id: string, userId: string) {
  await db.delete(automations).where(eq(automations.id, id));
  await audit(userId, "apagou", "automation", id);
}
export async function automationDetails(id: string) {
  const [versions, runs] = await Promise.all([
    db.select({ version: automationVersions.version, createdAt: automationVersions.createdAt, user: users.name }).from(automationVersions)
      .leftJoin(users, eq(users.id, automationVersions.userId)).where(eq(automationVersions.automationId, id)).orderBy(desc(automationVersions.version)).limit(10),
    db.execute(sql`select r.created_at as "createdAt", r.result, c.name, c.phone_e164 as phone from automation_runs r
      left join deals d on d.id = r.deal_id left join contacts c on c.id = d.contact_id where r.automation_id = ${id} order by r.created_at desc limit 15`),
  ]);
  return { versions, runs: runs.rows as { createdAt: string; result: { acoes?: string[] }; name: string | null; phone: string | null }[] };
}
/** Simula a automação agora, sem executar: quantos leads seriam afetados. */
export async function previewAutomation(input: AutomationInput) {
  const v = automationInputSchema.parse(input);
  const { previewCandidates } = await import("../rules/preview");
  return previewCandidates(v);
}

/* ---------- Listas ---------- */
export const listKinds = ["objection", "lost_reason", "quick_reply", "origin", "service", "keyword"] as const;
/** Palavras-chave: as frases ficam uma por linha, sem linhas vazias. */
const cleanPhrases = (body: string | null) => (body ?? "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
export async function addListItem(kind: (typeof listKinds)[number], label: string, body: string | null, userId: string) {
  const l = z.string().trim().min(1).max(60).parse(kind === "quick_reply" ? label.replace(/^\//, "").toLowerCase().replace(/\s+/g, "-") : label);
  if (kind === "quick_reply" && !body?.trim()) throw new Error("Escreva o texto da resposta pronta.");
  if (kind === "keyword") { body = cleanPhrases(body); if (!body) throw new UserFacingError("Escreva ao menos uma palavra ou frase."); }
  const [{ max }] = (await db.execute(sql`select coalesce(max(position), -1)::int as max from lists where kind = ${kind}`)).rows as { max: number }[];
  await db.insert(lists).values({ kind, label: l, body: body?.trim() || null, position: max + 1 })
    .onConflictDoUpdate({ target: [lists.kind, lists.label], set: { active: true, body: body?.trim() || null } });
  await audit(userId, "adicionou", "list", null, { kind, label: l });
}
/** O tipo do item da lista (a action escolhe a permissão: serviço pede "Mudar serviços e preços"). */
export async function listItemKind(id: string): Promise<string | null> {
  const [cur] = await db.select({ kind: lists.kind }).from(lists).where(eq(lists.id, id));
  return cur?.kind ?? null;
}
export async function updateListItem(id: string, label: string, body: string | null, active: boolean, userId: string) {
  const [cur] = await db.select({ kind: lists.kind }).from(lists).where(eq(lists.id, id));
  if (cur?.kind === "keyword") { body = cleanPhrases(body); if (!body) throw new UserFacingError("Escreva ao menos uma palavra ou frase."); }
  await db.update(lists).set({ label: z.string().trim().min(1).max(60).parse(label), body: body?.trim() || null, active }).where(eq(lists.id, id));
  await audit(userId, "editou", "list", id, { label, active });
}

/** Palavra-chave: "Subir na Fila" (a conversa passa na frente dentro da sua seção). */
export async function setKeywordBoost(id: string, boost: boolean, userId: string) {
  await db.update(lists).set({ meta: { boost } }).where(and(eq(lists.id, id), eq(lists.kind, "keyword")));
  await audit(userId, "editou", "list", id, { boost });
}

/* ---------- WhatsApp ---------- */
export function instanceNameFrom(name: string) {
  const base = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "numero";
  return `casa-fiaes-${base}-${Math.random().toString(36).slice(2, 6)}`;
}
export async function createChannel(name: string, userId: string) {
  const n = z.string().trim().min(2, "Dê um nome para o número, ex.: Recepção").max(40).parse(name);
  const instanceName = instanceNameFrom(n);
  await whatsapp().createInstance(instanceName);
  const [c] = await db.insert(channels).values({ name: n, instanceName, status: "aguardando_qr" }).returning();
  await audit(userId, "criou", "channel", c.id, { name: n });
  return c;
}
export async function channelQr(id: string) {
  const [c] = await db.select().from(channels).where(eq(channels.id, id));
  if (!c) throw new Error("Número não encontrado");
  await whatsapp().syncWebhook?.(c.instanceName).catch((e) => console.error("[whatsapp] syncWebhook", e));
  const r = await whatsapp().connect(c.instanceName);
  const status = r.status === "conectado" ? "conectado" : r.status === "aguardando_qr" ? "aguardando_qr" : c.status;
  await db.update(channels).set({ status, ...(r.status === "aguardando_qr" ? { lastQrAt: new Date() } : {}) }).where(eq(channels.id, id));
  // A tela pode saber da conexão antes do webhook: liga o modo quieto aqui também (idempotente).
  if (status === "conectado") await startQuietIfPaired(c, null);
  return r;
}
export async function channelState(id: string) {
  const [c] = await db.select().from(channels).where(eq(channels.id, id));
  if (!c) throw new Error("Número não encontrado");
  const st = await whatsapp().state(c.instanceName);
  if (st !== c.status) await db.update(channels).set({ status: st }).where(eq(channels.id, id));
  if (st === "conectado") await startQuietIfPaired(c, null);
  return st;
}
export async function disconnectChannel(id: string, remove: boolean, userId: string) {
  const [c] = await db.select().from(channels).where(eq(channels.id, id));
  if (!c) return;
  if (remove) {
    // Apagar a instância também desconecta; se falhar, desconecta e tenta apagar de novo (antes ficava viva com o número).
    try { await whatsapp().remove(c.instanceName); } catch {
      try { await whatsapp().logout(c.instanceName); } catch { /* já desconectado */ }
      try { await whatsapp().remove(c.instanceName); } catch (e) { console.error("[canal] não foi possível apagar a instância", c.instanceName, e); }
    }
    await db.update(channels).set({ status: "desconectado", name: `${c.name}${REMOVED_SUFFIX}` }).where(eq(channels.id, id));
  } else {
    try { await whatsapp().logout(c.instanceName); } catch { /* já desconectado */ }
    await db.update(channels).set({ status: "desconectado" }).where(eq(channels.id, id));
  }
  await audit(userId, remove ? "removeu" : "desconectou", "channel", id);
}

/* ---------- Equipe: ver ./profiles.ts (perfis, convite com perfil, ativar/desativar) ---------- */

