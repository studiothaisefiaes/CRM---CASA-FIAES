import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { automations, automationVersions, auditLog, channels, lists, settings, stages, users } from "../db/schema";
import { automationInputSchema, type AutomationInput } from "../rules/types";
import { whatsapp } from "../whatsapp/evolution";
import { createInvite } from "../auth/users";

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
export async function saveAutomation(id: string | null, input: AutomationInput, userId: string) {
  const v = automationInputSchema.parse(input);
  return db.transaction(async (tx) => {
    if (!id) {
      const [a] = await tx.insert(automations).values({ ...v, updatedBy: userId }).returning();
      await tx.insert(automationVersions).values({ automationId: a.id, version: 1, snapshot: v, userId });
      return a.id;
    }
    const [cur] = await tx.select().from(automations).where(eq(automations.id, id));
    if (!cur) throw new Error("Automação não encontrada");
    const next = cur.version + 1;
    await tx.update(automations).set({ ...v, version: next, updatedBy: userId, updatedAt: new Date() }).where(eq(automations.id, id));
    await tx.insert(automationVersions).values({ automationId: id, version: next, snapshot: v, userId });
    return id;
  });
}
export async function toggleAutomation(id: string, enabled: boolean, userId: string) {
  await db.update(automations).set({ enabled, updatedBy: userId, updatedAt: new Date() }).where(eq(automations.id, id));
  await audit(userId, enabled ? "ligou" : "desligou", "automation", id);
}
export async function restoreAutomation(id: string, version: number, userId: string) {
  const [v] = await db.select().from(automationVersions).where(and(eq(automationVersions.automationId, id), eq(automationVersions.version, version)));
  if (!v) throw new Error("Versão não encontrada");
  return saveAutomation(id, automationInputSchema.parse(v.snapshot), userId);
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
export const listKinds = ["objection", "lost_reason", "quick_reply", "origin"] as const;
export async function addListItem(kind: (typeof listKinds)[number], label: string, body: string | null, userId: string) {
  const l = z.string().trim().min(1).max(60).parse(kind === "quick_reply" ? label.replace(/^\//, "").toLowerCase().replace(/\s+/g, "-") : label);
  if (kind === "quick_reply" && !body?.trim()) throw new Error("Escreva o texto da resposta pronta.");
  const [{ max }] = (await db.execute(sql`select coalesce(max(position), -1)::int as max from lists where kind = ${kind}`)).rows as { max: number }[];
  await db.insert(lists).values({ kind, label: l, body: body?.trim() || null, position: max + 1 })
    .onConflictDoUpdate({ target: [lists.kind, lists.label], set: { active: true, body: body?.trim() || null } });
  await audit(userId, "adicionou", "list", null, { kind, label: l });
}
export async function updateListItem(id: string, label: string, body: string | null, active: boolean, userId: string) {
  await db.update(lists).set({ label: z.string().trim().min(1).max(60).parse(label), body: body?.trim() || null, active }).where(eq(lists.id, id));
  await audit(userId, "editou", "list", id, { label, active });
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
  return r;
}
export async function channelState(id: string) {
  const [c] = await db.select().from(channels).where(eq(channels.id, id));
  if (!c) throw new Error("Número não encontrado");
  const st = await whatsapp().state(c.instanceName);
  if (st !== c.status) await db.update(channels).set({ status: st }).where(eq(channels.id, id));
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
    await db.update(channels).set({ status: "desconectado", name: `${c.name} (removido)` }).where(eq(channels.id, id));
  } else {
    try { await whatsapp().logout(c.instanceName); } catch { /* já desconectado */ }
    await db.update(channels).set({ status: "desconectado" }).where(eq(channels.id, id));
  }
  await audit(userId, remove ? "removeu" : "desconectou", "channel", id);
}

/* ---------- Equipe ---------- */
export async function inviteMember(input: { name: string; email: string; role: "gestor" | "atendente" }, userId: string) {
  const v = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email("E-mail inválido"), role: z.enum(["gestor", "atendente"]) }).parse(input);
  const token = await createInvite(v);
  await audit(userId, "convidou", "user", null, { email: v.email, role: v.role });
  return token;
}
export async function setMember(id: string, patch: { role?: "gestor" | "atendente"; active?: boolean }, userId: string) {
  if (id === userId && (patch.active === false || patch.role === "atendente")) throw new Error("Você não pode tirar o próprio acesso de gestão.");
  if (patch.role === "atendente" || patch.active === false) {
    const [{ n }] = (await db.execute(sql`select count(*)::int as n from users where role = 'gestor' and active and id <> ${id}`)).rows as { n: number }[];
    if (n === 0) throw new Error("O CRM precisa de pelo menos uma pessoa na gestão.");
  }
  await db.update(users).set(patch).where(eq(users.id, id));
  if (patch.active === false) await db.execute(sql`delete from sessions where user_id = ${id}`);
  await audit(userId, "alterou", "user", id, patch);
}

