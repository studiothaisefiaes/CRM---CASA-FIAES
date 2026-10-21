import Link from "next/link";
import { requirePro } from "@/server/auth/pro-session";
import { getProAppointment, listMyServices } from "@/server/queries/pro";
import { caixaOn } from "@/server/domain/agenda/ports";
import { dayTitle, proActionsFor } from "@/lib/pro-day";
import { NextClientCard } from "@/components/pro/next-client-card";
import { AppointmentActions } from "@/components/pro/appointment-actions";
import { NoteSheet } from "@/components/pro/note-sheet";

export const metadata = { title: "Horário" };

export default async function ProAppointmentPage({ params }: PageProps<"/pro/horario/[id]">) {
  const { pro } = await requirePro();
  if (!pro) return null;
  const { id } = await params;
  const now = new Date();
  const a = await getProAppointment(pro, id, now);
  if (!a) return <p role="status" className="text-graphite">Horário não encontrado.</p>;
  const actions = proActionsFor(a.status, new Date(a.startsAt).getTime(), now.getTime());
  const services = actions.includes("finalizar") && (await caixaOn()) ? await listMyServices(pro) : [];
  return (
    <main className="flex flex-col gap-4">
      <Link href={`/pro/dia/${a.day}`} className="inline-flex min-h-11 items-center text-sm font-medium text-gold-ink">‹ {dayTitle(a.day)}</Link>
      <NextClientCard item={a} card={a.card} nowMs={now.getTime()} label="Horário" link={false} />
      <AppointmentActions appointmentId={a.id} actions={actions} services={services} clientName={a.clientName} />
      {a.contactId && <NoteSheet appointmentId={a.id} />}
    </main>
  );
}
