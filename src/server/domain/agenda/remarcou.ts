import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments, deals, stages } from "../../db/schema";
import { cancelAppointmentsTx } from "./visits";
import { afterAgendaChange } from "./notify";
import { ACTIVE_STATUSES } from "@/lib/appointment-status";
import { numberContactIds } from "../people-on-number";
import { enterMissedTx } from "../funnel";
import { replaceOpenTaskTx } from "../tasks";
import { UserFacingError } from "../errors";

const SAME_VISIT_MS = 12 * 3_600_000;

/**
 * "Remarcou" no "Ela veio?" (Cati 30/10): nem veio nem faltou. Os horários vencidos daquela visita saem com o motivo "remarcado", sem contar
 * falta; a conversa acompanha o próximo horário ou, sem nenhum, sai de Agendado com o combinado de remarcar.
 */
export async function markRescheduled(dealId: string, userId: string, now = new Date()): Promise<{ temNovo: boolean }> {
  const r = await db.transaction(async (tx) => {
    const [d] = await tx.select({ contactId: deals.contactId, scheduledAt: deals.scheduledAt }).from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d?.scheduledAt) throw new UserFacingError("Só dá para remarcar uma conversa com horário marcado.");
    const ids = await numberContactIds(d.contactId, tx);
    const at = d.scheduledAt.getTime();
    const rows = await tx.select({ id: appointments.id, startsAt: appointments.startsAt }).from(appointments)
      .where(and(inArray(appointments.contactId, ids), isNull(appointments.avecTwinOf), inArray(appointments.status, [...ACTIVE_STATUSES])));
    const vencidos = rows.filter((a) => a.startsAt <= now && Math.abs(a.startsAt.getTime() - at) <= SAME_VISIT_MS);
    const days = new Set<string>();
    let dealIds: string[] = [];
    for (const a of vencidos) {
      const c = await cancelAppointmentsTx(tx, { appointmentId: a.id, reason: "remarcado", via: "recepcao" }, userId, now);
      days.add(c.day); dealIds = [...dealIds, ...c.dealIds];
    }
    const [novo] = await tx.select({ id: appointments.id }).from(appointments)
      .where(and(inArray(appointments.contactId, ids), isNull(appointments.avecTwinOf), inArray(appointments.status, ["agendado", "confirmado"]), gt(appointments.startsAt, now))).limit(1);
    // O funil não mexeu (horário só na conversa, ou conversa antiga): sai de Agendado aqui, senão a pergunta volta.
    const [cur] = await tx.select({ kind: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId));
    if (!novo && (cur?.kind === "agendado" || cur?.kind === "na_casa")) {
      await replaceOpenTaskTx(tx, dealId, d.contactId, "comparecimento", null, null);
      await enterMissedTx(tx, dealId, userId, "remarcou", now);
      dealIds.push(dealId);
    }
    return { temNovo: !!novo, days: [...days], dealIds };
  });
  await afterAgendaChange(r.days, r.dealIds);
  return { temNovo: r.temNovo };
}
