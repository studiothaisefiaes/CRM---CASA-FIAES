import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "../../db";
import { appointmentLabels, appointments, auditLog, settings } from "../../db/schema";
import { UserFacingError } from "../errors";
import { assertFuncao } from "../funcoes";
import { dayOf } from "@/lib/agenda";
import { can } from "@/lib/permissions";
import { VISIT_TYPES, VISIT_TYPE_LABEL, VISIT_TYPE_MAX, type VisitType, type VisitTypeOption } from "@/lib/visit-type";
import { TAG_COLORS } from "@/lib/tag-colors";
import type { Actor } from "./actor";
import { afterAgendaChange } from "./notify";

type Q = Tx | typeof db;
export type AppointmentLabel = { id: string; name: string; color: string | null; active: boolean; position: number };
const NO_PERM = "Você não tem permissão para isso.";
const TYPES_KEY = "tipos_horario";

/** Os marcadores, na ordem da Casa. Por padrão só os ativos; `all` traz também os desativados (Configurações). */
export async function listAppointmentLabels(opts: { all?: boolean } = {}, q: Q = db): Promise<AppointmentLabel[]> {
  const rows = await q.select({ id: appointmentLabels.id, name: appointmentLabels.name, color: appointmentLabels.color, active: appointmentLabels.active, position: appointmentLabels.position })
    .from(appointmentLabels).orderBy(asc(appointmentLabels.position), asc(appointmentLabels.name));
  return opts.all ? rows : rows.filter((r) => r.active);
}

const saveSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Escreva o nome do marcador.").max(40, "Use até 40 caracteres no nome."),
  color: z.enum(TAG_COLORS).nullish(),
  active: z.boolean().optional(),
});

/** Cria (sem id) ou edita um marcador. Nome único sem diferenciar maiúsculas. Só quem tem config.marcadores (a action confere) e com a função ligada. */
export async function saveAppointmentLabel(input: { id?: string; name: string; color?: string | null; active?: boolean }, userId: string): Promise<{ id: string }> {
  await assertFuncao("marcadores");
  const v = saveSchema.parse({ ...input, name: input.name.replace(/\s+/g, " ") });
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: appointmentLabels.id, name: appointmentLabels.name }).from(appointmentLabels).where(sql`lower(${appointmentLabels.name}) = lower(${v.name})`);
    if (dup && dup.id !== v.id) throw new UserFacingError(`Já existe o marcador ${dup.name}.`);
    if (v.id) {
      const [old] = await tx.select().from(appointmentLabels).where(eq(appointmentLabels.id, v.id));
      if (!old) throw new UserFacingError("Marcador não encontrado.");
      await tx.update(appointmentLabels).set({ name: v.name, color: v.color === undefined ? old.color : v.color, active: v.active ?? old.active }).where(eq(appointmentLabels.id, v.id));
      await tx.insert(auditLog).values({ userId, action: "editou", entity: "appointment_label", entityId: v.id, data: { de: { name: old.name, color: old.color, active: old.active }, para: { name: v.name, color: v.color === undefined ? old.color : v.color, active: v.active ?? old.active } } });
      return { id: v.id };
    }
    const [{ next }] = await tx.select({ next: sql<number>`coalesce(max(${appointmentLabels.position}) + 1, 0)::int` }).from(appointmentLabels);
    const [n] = await tx.insert(appointmentLabels).values({ name: v.name, color: v.color ?? null, active: v.active ?? true, position: next, createdBy: userId }).returning({ id: appointmentLabels.id });
    await tx.insert(auditLog).values({ userId, action: "criou", entity: "appointment_label", entityId: n.id, data: { name: v.name, color: v.color ?? null } });
    return { id: n.id };
  });
}

/* ───────────── Tipos do horário (rótulo e "em uso" editáveis) ───────────── */

type TypesRaw = Partial<Record<VisitType, { label?: string; active?: boolean }>>;

/** Os tipos como a tela usa: rótulo em vigor (o sugerido se ninguém mudou) e se estão em uso. */
export async function getVisitTypes(q: Q = db): Promise<VisitTypeOption[]> {
  const raw = (await q.select({ value: settings.value }).from(settings).where(eq(settings.key, TYPES_KEY)))[0]?.value;
  const v: TypesRaw = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as TypesRaw) : {};
  return VISIT_TYPES.map((t) => {
    const label = typeof v[t]?.label === "string" ? v[t]!.label!.trim() : "";
    return { value: t, label: label || VISIT_TYPE_LABEL[t], active: typeof v[t]?.active === "boolean" ? v[t]!.active! : true };
  });
}
export const visitTypeLabelMap = (types: VisitTypeOption[]) => Object.fromEntries(types.map((t) => [t.value, t.label])) as Record<VisitType, string>;

const typesPatchSchema = z.object(Object.fromEntries(VISIT_TYPES.map((t) => [t, z.object({
  /** Vazio = "Usar o texto sugerido". */ label: z.string().trim().max(VISIT_TYPE_MAX, `Use até ${VISIT_TYPE_MAX} caracteres.`).optional(),
  active: z.boolean().optional(),
}).strict().optional()]))).strict();
export type VisitTypesPatch = z.input<typeof typesPatchSchema>;

/** Muda o rótulo e/ou o "em uso" dos tipos do `patch`; o resto fica como está. Rótulo vazio volta ao texto sugerido. */
export async function saveVisitTypes(patch: VisitTypesPatch, userId: string): Promise<VisitTypeOption[]> {
  await assertFuncao("tipo_horario");
  const clean = typesPatchSchema.parse(patch);
  return db.transaction(async (tx) => {
    const now = await getVisitTypes(tx);
    const value: TypesRaw = {};
    for (const t of now) {
      const p = clean[t.value];
      const label = p?.label !== undefined ? p.label.replace(/\s+/g, " ") : t.label;
      value[t.value] = { label: label === VISIT_TYPE_LABEL[t.value] ? "" : label, active: p?.active ?? t.active };
    }
    const names = VISIT_TYPES.map((t) => (value[t]!.label || VISIT_TYPE_LABEL[t]).toLowerCase());
    if (new Set(names).size !== names.length) throw new UserFacingError("Os dois tipos não podem ter o mesmo nome.");
    await tx.insert(settings).values({ key: TYPES_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
    await tx.insert(auditLog).values({ userId, action: "editou", entity: "settings", entityId: TYPES_KEY, data: value });
    return getVisitTypes(tx);
  });
}

/* ───────────── Pôr marcador e tipo no horário ───────────── */

/** O marcador existe e está em uso; devolve o nome para a auditoria. */
export async function assertLabelUsable(labelId: string, q: Q = db): Promise<string> {
  const [l] = await q.select({ name: appointmentLabels.name, active: appointmentLabels.active }).from(appointmentLabels).where(eq(appointmentLabels.id, z.string().uuid("Marcador não encontrado.").parse(labelId)));
  if (!l) throw new UserFacingError("Marcador não encontrado.");
  if (!l.active) throw new UserFacingError("Esse marcador não está mais em uso.");
  return l.name;
}
/** O tipo é Indicação ou Noiva e está em uso. */
export async function assertVisitTypeUsable(type: string, q: Q = db): Promise<void> {
  const t = (await getVisitTypes(q)).find((x) => x.value === type);
  if (!t) throw new UserFacingError("Esse tipo de horário não existe.");
  if (!t.active) throw new UserFacingError("Esse tipo não está mais em uso.");
}
/** Quem põe marcador/tipo: a pessoa precisa de agenda.marcador (a action confere de novo; esconder o botão não basta). */
export function assertCanSetMarker(actor: Actor) {
  if (!can(actor.perms, "agenda.marcador")) throw new UserFacingError(NO_PERM);
}

/**
 * Põe (ou tira, com null) o marcador do horário. Função `marcadores` e permissão `agenda.marcador`. Não marca `crmTouchedAt`: o marcador é só do CRM
 * e não pode travar o status que vem do Avec. Horário do Avec aceita marcador.
 */
export async function setAppointmentLabel(appointmentId: string, labelId: string | null, actor: Actor, now = new Date()): Promise<void> {
  await assertFuncao("marcadores");
  assertCanSetMarker(actor);
  const day = await db.transaction(async (tx) => {
    const [a] = await tx.select({ labelId: appointments.labelId, startsAt: appointments.startsAt, avecTwinOf: appointments.avecTwinOf })
      .from(appointments).where(eq(appointments.id, z.string().uuid().parse(appointmentId))).for("update");
    if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    if (a.labelId === labelId) return null;
    const name = labelId ? await assertLabelUsable(labelId, tx) : null;
    await tx.update(appointments).set({ labelId, updatedAt: now, updatedBy: actor.id }).where(eq(appointments.id, appointmentId));
    await tx.insert(auditLog).values({ userId: actor.id, action: "marcador_horario", entity: "appointment", entityId: appointmentId, createdAt: now, data: { de: a.labelId, para: labelId, marcador: name } });
    return dayOf(a.startsAt);
  });
  if (day) await afterAgendaChange([day]);
}

/** Põe (ou tira, com null) o tipo do horário. Função `tipo_horario`, permissão `agenda.marcador`, tipo em uso. Não marca `crmTouchedAt`. */
export async function setVisitType(appointmentId: string, type: VisitType | null, actor: Actor, now = new Date()): Promise<void> {
  await assertFuncao("tipo_horario");
  assertCanSetMarker(actor);
  const day = await db.transaction(async (tx) => {
    const [a] = await tx.select({ visitType: appointments.visitType, startsAt: appointments.startsAt, avecTwinOf: appointments.avecTwinOf })
      .from(appointments).where(eq(appointments.id, z.string().uuid().parse(appointmentId))).for("update");
    if (!a || a.avecTwinOf) throw new UserFacingError("Horário não encontrado.");
    if (type != null) await assertVisitTypeUsable(type, tx);
    if ((a.visitType ?? null) === type) return null;
    await tx.update(appointments).set({ visitType: type, updatedAt: now, updatedBy: actor.id }).where(eq(appointments.id, appointmentId));
    await tx.insert(auditLog).values({ userId: actor.id, action: "tipo_horario", entity: "appointment", entityId: appointmentId, createdAt: now, data: { de: a.visitType, para: type } });
    return dayOf(a.startsAt);
  });
  if (day) await afterAgendaChange([day]);
}
