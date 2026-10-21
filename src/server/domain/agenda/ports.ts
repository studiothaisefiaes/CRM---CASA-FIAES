/**
 * As portas do 6B (agenda) e do 6C (caixa) que os Lotes 7A e 7B usam, num lugar só (seção "Contrato" do plano dos Lotes 7A/7B).
 * O resto do 7A/7B chama estas funções, nunca o 6B/6C direto. Se a assinatura real for outra, ajuste SÓ o corpo daqui.
 *
 * Assinaturas conferidas na Tarefa 7A.1, Passo 0 (branch agenda-app, 15/10):
 * - 6B `setAppointmentStatus(id, status, userId, opts: { via, now, confirmedVia })`: igual; ganhou `professionalId` (posse) nesta tarefa.
 * - 6B `ensureVisitFor(appointmentId, tx?)`: igual (o 2º argumento é opcional).
 * - 6B `createVisit`, `rescheduleAppointment(id, input, actor)`, `cancelAppointments(input, actor)`: recebem `Actor = { id, perms }`, não o id.
 * - 6C (merge da frente, 15/10): `getCaixaMode`, `openComandaForAppointment(appointmentId, actor)` e `addItem(comandaId, input, actor)`;
 *   a comissão vem de `commissionReport` (src/server/domain/caixa/commission.ts).
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, profiles, users } from "../../db/schema";
import { setAppointmentStatus } from "../appointments";
import { UserFacingError } from "../errors";
import { cancelAppointmentsTx, createVisit, ensureVisitFor, rescheduleAppointment } from "./visits";
import { afterAgendaChange } from "./notify";
import { checkCancel } from "@/lib/appointment-status";
import type { Actor } from "./actor";
import { dayRulesFor } from "./availability";
import type { Db, Tx } from "../../db";
import type { DayRules } from "@/lib/free-slots";
import type { CommissionLineLike } from "@/lib/pro-earnings";
import { getCaixaMode } from "../caixa/mode";
import { addItem, openComandaForAppointment } from "../caixa/comandas";
import { commissionReport } from "../caixa/commission";

export type PortVia = "recepcao" | "profissional" | "link" | "online";
export type PortStatus = "agendado" | "confirmado" | "chegou" | "em_atendimento" | "compareceu" | "faltou";

/** Porta única de status (6B). `onlyProfessionalId`: a posse é conferida dentro da transação ("Horário não encontrado."). */
export async function changeStatus(i: { appointmentId: string; status: PortStatus; actorId: string | null; via: PortVia; onlyProfessionalId?: string; now?: Date }): Promise<{ changed: boolean }> {
  return setAppointmentStatus(i.appointmentId, i.status, i.actorId, { via: i.via === "online" ? "sistema" : i.via, now: i.now, professionalId: i.onlyProfessionalId });
}

/** A visita do horário (6B cria juntando os horários ativos da mesma cliente no dia, quando o horário veio do Avec sem visita). */
export async function visitIdFor(appointmentId: string): Promise<string> {
  return ensureVisitFor(appointmentId);
}

/** O caixa está no CRM (`caixa_modo = "crm"`)? Com o caixa no Avec, o app não toca na comanda. */
export async function caixaOn(): Promise<boolean> {
  return (await getCaixaMode()) === "crm";
}

/** A comanda aberta da visita do horário (o 6C reaproveita a aberta ou cria, já com os horários faturáveis da visita). */
export async function openComandaPort(appointmentId: string, actorId: string): Promise<string> {
  return (await openComandaForAppointment(appointmentId, await actorFor(actorId))).comandaId;
}

/** Um serviço na comanda (regras do item do 6C: profissional obrigatória, preço vazio a recepção completa). */
export async function addServiceItemPort(i: { comandaId: string; serviceId: string | null; label: string; professionalId: string; appointmentId: string | null; unitCents: number | null; actorId: string }): Promise<string> {
  return (await addItem(i.comandaId, { kind: "servico", serviceId: i.serviceId, label: i.label, professionalId: i.professionalId, qty: 1, unitCents: i.unitCents }, await actorFor(i.actorId))).id;
}

/* ───────── Lote 7A.7: cancelar, marcar e remarcar pelas portas do 6B ───────── */

/** A pessoa como o 6B quer (`Actor = { id, perms }`): as permissões do perfil dela, lidas do banco. */
async function actorFor(userId: string): Promise<Actor> {
  const [u] = await db.select({ perms: profiles.permissions }).from(users).leftJoin(profiles, eq(profiles.id, users.profileId)).where(eq(users.id, userId));
  return { id: userId, perms: u?.perms ?? [] };
}

/**
 * Cancelar pela porta do 6B (motivo e por onde ficam gravados; o funil do 1C acompanha), todos numa transação só.
 * Horário já cancelado (ou que não ocupa mais) fica de fora em vez de recusar o resto.
 */
export async function cancelMany(i: { appointmentIds: string[]; reason: "cliente_desmarcou" | "casa_desmarcou" | "recusado"; note: string | null; actorId: string | null; via: PortVia; now?: Date }): Promise<{ cancelled: number }> {
  const now = i.now ?? new Date();
  const via = i.via === "link" ? "link" : "recepcao"; // o 6B só aceita recepcao | link em cancelled_via
  const r = await db.transaction(async (tx) => {
    const days = new Set<string>(), dealIds = new Set<string>();
    let cancelled = 0;
    for (const id of [...new Set(i.appointmentIds)]) {
      const [a] = await tx.select({ status: appointments.status }).from(appointments).where(eq(appointments.id, id));
      if (!a || !checkCancel(a.status).ok) continue;
      const c = await cancelAppointmentsTx(tx, { appointmentId: id, scope: "este", reason: i.reason, note: i.note, via }, i.actorId, now);
      cancelled += c.cancelledIds.length;
      days.add(c.day);
      for (const d of c.dealIds) dealIds.add(d);
    }
    return { cancelled, days, dealIds };
  });
  if (r.cancelled) await afterAgendaChange(r.days, r.dealIds);
  return { cancelled: r.cancelled };
}

/** Marcar pela porta do 6B (serviços em sequência a partir do primeiro início). Usada pelos testes de ligação dos avisos (7A) e do link (7B). */
export async function bookVisitPort(i: { contactId: string | null; items: { serviceId: string; professionalId: string; startsAt: Date; durationMin: number }[]; actorId: string; via?: string }): Promise<{ visitId: string; appointmentIds: string[] }> {
  if (!i.contactId) throw new UserFacingError("Escolha a cliente.");
  const first = i.items[0];
  const r = await createVisit({
    requestKey: randomUUID(), client: { contactId: i.contactId }, startsAt: first.startsAt.toISOString(),
    items: i.items.map((it, k) => ({ serviceId: it.serviceId, professionalId: it.professionalId, durationMin: it.durationMin, mode: k > 0 && it.startsAt.getTime() === i.items[k - 1].startsAt.getTime() ? "junto" as const : "depois" as const })),
  }, await actorFor(i.actorId));
  return { visitId: r.visitId, appointmentIds: r.appointmentIds };
}

/** Remarcar pela porta do 6B. Usada pelos testes de ligação dos avisos (7A) e do link (7B). */
export async function reschedulePort(i: { appointmentId: string; startsAt: Date; professionalId: string; actorId: string }): Promise<{ changed: boolean }> {
  await rescheduleAppointment(i.appointmentId, { startsAt: i.startsAt.toISOString(), professionalId: i.professionalId, confirmProChange: true }, await actorFor(i.actorId));
  return { changed: true };
}

/** O dia de uma profissional para o motor (6A): faixas, bloqueios (pedido de folga = só aviso) e horários ocupados. */
export async function dayRulesPort(q: Tx | Db, professionalId: string, day: string): Promise<DayRules> {
  return dayRulesFor({ professionalId, day }, q);
}

/* ───────── Lote 7A.10: comissão (6C) ───────── */

/**
 * As linhas do relatório de comissão do 6C (`commissionReport`) de uma profissional num período. Fase A: inclui as linhas em que ela foi
 * assistente ("Corte (assistente de Ana)", com o retrato dela) e as retidas até a cliente quitar a dívida (`aguardando_quitacao`, nunca somadas).
 */
export async function commissionLinesPort(o: { from: string; to: string; professionalId: string }): Promise<CommissionLineLike[]> {
  return (await commissionReport(o)).rows.flatMap((r) => r.lines);
}
