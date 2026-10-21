import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, alerts, appointments, auditLog, professionals } from "../../db/schema";
import { UserFacingError } from "../errors";
import { emit } from "../events";
import { assertCanBook } from "../agenda/mode";
import { periodLabel, validateLeave, type LeaveInput } from "@/lib/leave-request";
import { folgaAlertKey } from "@/lib/alert-links";
import { blockAppliesOn } from "@/lib/agenda-blocks";
import { dayOf, hmToMinutes, shiftDay, todayBahia } from "@/lib/agenda";
import { slotMs } from "@/lib/schedule";
import { firstName } from "@/lib/authorship";
import { minuteIn, timeOf, titleCase } from "@/lib/pro-day";
import { queueLeaveNotificationTx } from "./notifications";
import type { ProContext } from "../../queries/pro";

export type LeaveRequestItem = { id: string; professionalId: string; professional: string; title: string; period: string; notes: string | null; requestedAt: string; clients: string[] };
export type MyLeaveItem = { id: string; title: string; period: string; status: "pedido" | "aprovado" | "recusado"; note: string | null };
type BlockShape = { professionalId: string | null; startsOn: string; endsOn: string; startTime: string; endTime: string; weekdays: number[] | null };

const OCCUPY = ["agendado", "confirmado", "chegou", "em_atendimento", "solicitado", "conferir"];

/** Clientes marcadas da profissional dentro do período, para a recepção remarcar ("Paula 15:00 (20/10)"). Nada é remarcado sozinho. */
async function clientsInPeriod(b: BlockShape): Promise<string[]> {
  if (!b.professionalId) return [];
  const s = hmToMinutes(b.startTime) ?? 0, e = hmToMinutes(b.endTime) ?? 1440;
  const rows = await db.select({ startsAt: appointments.startsAt, name: appointments.clientName }).from(appointments)
    .where(and(eq(appointments.professionalId, b.professionalId), inArray(appointments.status, OCCUPY), isNull(appointments.avecTwinOf),
      gte(appointments.startsAt, new Date(slotMs(b.startsOn, "00:00"))), lt(appointments.startsAt, new Date(slotMs(shiftDay(b.endsOn, 1), "00:00")))))
    .orderBy(asc(appointments.startsAt));
  return rows.filter((r) => { const m = minuteIn(r.startsAt.getTime()); return blockAppliesOn(b, dayOf(r.startsAt)) && m >= s && m < e; })
    .map((r) => { const d = dayOf(r.startsAt); return `${titleCase(firstName(r.name) ?? "cliente")} ${timeOf(r.startsAt.getTime())} (${d.slice(8, 10)}/${d.slice(5, 7)})`; });
}

/** Pedido de folga ou bloqueio pelo app: nasce "pedido" (só avisa no motor), avisa a gestão no sino e vale em qualquer modo da agenda. */
export async function requestLeave(pro: ProContext, input: LeaveInput, now = new Date()): Promise<{ id: string }> {
  const v = validateLeave(input, todayBahia(now));
  if (!v.ok) throw new UserFacingError(v.error);
  const r = v.row;
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(agendaBlocks).values({
      id, professionalId: pro.professionalId, title: r.title, notes: r.notes, startsOn: r.startsOn, endsOn: r.endsOn, startTime: r.startTime, endTime: r.endTime, weekdays: null,
      externalKey: `crm:blq:${id}`, origin: "crm", reason: r.reason, createdBy: pro.userId, requestStatus: "pedido", requestedBy: pro.userId, createdAt: now,
    });
    await tx.insert(auditLog).values({ userId: pro.userId, action: "pediu_folga", entity: "agenda_block", entityId: id, data: { ...r } });
    await tx.insert(alerts).values({ userId: null, audience: "gestao", type: "folga_pedida", severity: "info", dedupeKey: folgaAlertKey(id),
      message: `${titleCase(pro.name)} pediu ${r.title.toLowerCase()} em ${periodLabel(r)}. Aprove ou recuse na Agenda.` });
  });
  await emit("agenda_alterada", { day: r.startsOn });
  await emit("alerta", {});
  return { id };
}

/**
 * Aprovar ou recusar (recepção, `agenda.marcar`). Aprovar é criar bloqueio: segue o modo da agenda (recusado no modo consulta).
 * Recusar exige o motivo, que ela vê. Os dois avisam a profissional e resolvem o aviso da gestão. Responder duas vezes é recusado.
 */
export async function decideLeave(blockId: string, decision: "aprovar" | "recusar", note: string | null, actorId: string, now = new Date()): Promise<{ clients: string[] }> {
  const text = note?.trim().replace(/\s+/g, " ") ?? "";
  if (decision === "recusar" && text.length < 3) throw new UserFacingError("Escreva o motivo da recusa (ela vai ver).");
  if (text.length > 200) throw new UserFacingError("Use até 200 caracteres.");
  if (decision === "aprovar") await assertCanBook();
  const b = await db.transaction(async (tx) => {
    const [row] = await tx.select().from(agendaBlocks).where(eq(agendaBlocks.id, blockId)).for("update");
    if (!row || row.deletedAt) throw new UserFacingError("Pedido não encontrado.");
    if (row.requestStatus !== "pedido") throw new UserFacingError("Esse pedido já foi respondido.");
    const status = decision === "aprovar" ? "aprovado" : "recusado";
    await tx.update(agendaBlocks).set({ requestStatus: status, decidedBy: actorId, decidedAt: now, decisionNote: text || null, updatedAt: now, updatedBy: actorId }).where(eq(agendaBlocks.id, blockId));
    await tx.insert(auditLog).values({ userId: actorId, action: decision === "aprovar" ? "aprovou_folga" : "recusou_folga", entity: "agenda_block", entityId: blockId, data: { de: "pedido", para: status, nota: text || null } });
    await tx.update(alerts).set({ resolvedAt: now, readAt: now }).where(and(eq(alerts.dedupeKey, folgaAlertKey(blockId)), isNull(alerts.resolvedAt)));
    if (row.professionalId) await queueLeaveNotificationTx(tx, { professionalId: row.professionalId, blockId, approved: decision === "aprovar", period: periodLabel(row), note: text || null, actorId, now });
    return row;
  });
  await emit("agenda_alterada", { day: b.startsOn });
  await emit("alerta", {});
  return { clients: decision === "aprovar" ? await clientsInPeriod(b) : [] };
}

/** "Pedidos (n)" da Agenda: os pedidos esperando resposta, com quem está marcada no período. */
export async function listLeaveRequests(): Promise<LeaveRequestItem[]> {
  const rows = await db.select({ b: agendaBlocks, pro: professionals.name }).from(agendaBlocks).innerJoin(professionals, eq(professionals.id, agendaBlocks.professionalId))
    .where(and(eq(agendaBlocks.requestStatus, "pedido"), isNull(agendaBlocks.deletedAt))).orderBy(asc(agendaBlocks.startsOn), asc(agendaBlocks.createdAt));
  return Promise.all(rows.map(async ({ b, pro }) => ({
    id: b.id, professionalId: b.professionalId!, professional: titleCase(pro), title: b.title, period: periodLabel(b), notes: b.notes, requestedAt: b.createdAt.toISOString(), clients: await clientsInPeriod(b),
  })));
}

/** Os pedidos dela: aguardando, aprovados e recusados (com o motivo), dos últimos 30 dias para a frente. */
export async function listMyLeaves(pro: ProContext, now = new Date()): Promise<MyLeaveItem[]> {
  const rows = await db.select().from(agendaBlocks).where(and(eq(agendaBlocks.professionalId, pro.professionalId), isNotNull(agendaBlocks.requestStatus), isNull(agendaBlocks.deletedAt),
    gte(agendaBlocks.endsOn, shiftDay(todayBahia(now), -30)))).orderBy(desc(agendaBlocks.startsOn));
  return rows.map((b) => ({ id: b.id, title: b.title, period: periodLabel(b), status: b.requestStatus!, note: b.decisionNote }));
}
