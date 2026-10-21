import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientLinks } from "../db/schema";
import { titleCase } from "@/lib/pro-day";
import { dueLabel } from "@/lib/next-action";
import { listClientNotes, type NoteView } from "./pro";

export type EntryExtras = { finishedBy: string | null; notes: NoteView[]; canNote: boolean; link: { activity: string | null; canCreate: boolean } };

/**
 * O que o card do horário mostra a mais:
 * - "Finalizado por Ana" (7A);
 * - a ficha técnica;
 * - o que a cliente fez pelo link ("Confirmou pelo link hoje 10:42") (7B);
 * - se dá para gerar o link (horário agendado ou confirmado, no futuro).
 */
export async function getEntryExtras(appointmentId: string, now = new Date()): Promise<EntryExtras> {
  const [a] = await db.select({
    contactId: appointments.contactId, status: appointments.status, startsAt: appointments.startsAt, visitId: appointments.visitId,
    confirmedVia: appointments.confirmedVia, confirmedAt: appointments.confirmedAt, cancelledVia: appointments.cancelledVia, cancelledAt: appointments.cancelledAt,
  }).from(appointments).where(eq(appointments.id, appointmentId));
  if (!a) return { finishedBy: null, notes: [], canNote: false, link: { activity: null, canCreate: false } };
  const fin = await db.execute(sql`select p.name from audit_log l join professionals p on p.user_id = l.user_id
    where l.entity = 'appointment' and l.entity_id = ${appointmentId} and l.data->>'para' = 'compareceu' order by l.created_at desc limit 1`);
  const name = (fin.rows[0] as { name: string } | undefined)?.name;
  const when = (d: Date) => dueLabel(d.getTime(), now.getTime());
  let activity: string | null = null;
  if (a.status === "confirmado" && a.confirmedVia === "link" && a.confirmedAt) activity = `Confirmou pelo link ${when(a.confirmedAt)}`;
  else if (a.status === "cancelado" && a.cancelledVia === "link" && a.cancelledAt) activity = `Cancelou pelo link ${when(a.cancelledAt)}`;
  else if (a.visitId) {
    const [l] = await db.select({ at: clientLinks.lastActionAt }).from(clientLinks)
      .where(and(eq(clientLinks.visitId, a.visitId), eq(clientLinks.lastAction, "pediu_remarcar"))).orderBy(desc(clientLinks.lastActionAt)).limit(1);
    if (l?.at) activity = `Pediu para remarcar pelo link ${when(l.at)}`;
  }
  return {
    finishedBy: name ? titleCase(name) : null,
    notes: a.contactId ? await listClientNotes(a.contactId, 3) : [],
    canNote: !!a.contactId,
    link: { activity, canCreate: (a.status === "agendado" || a.status === "confirmado") && a.startsAt.getTime() > now.getTime() },
  };
}
