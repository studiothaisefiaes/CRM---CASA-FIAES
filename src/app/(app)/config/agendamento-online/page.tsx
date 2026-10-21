import { and, asc, eq } from "drizzle-orm";
import { requirePerm } from "@/server/auth/session";
import { db } from "@/server/db";
import { lists } from "@/server/db/schema";
import { listProfessionals } from "@/server/domain/professionals";
import { getOnlineBooking } from "@/server/domain/client-link/settings";
import { getAgendaMode } from "@/server/domain/agenda/mode";
import { OnlineBookingSettings } from "@/components/config/online-booking-settings";
import { clientLinkBase } from "@/lib/client-host";

export const metadata = { title: "Agendamento online" };

export default async function AgendamentoOnlinePage() {
  await requirePerm("config.sistema");
  const [value, services, pros, mode] = await Promise.all([
    getOnlineBooking(),
    db.select({ id: lists.id, label: lists.label, durationMin: lists.durationMin }).from(lists).where(and(eq(lists.kind, "service"), eq(lists.active, true))).orderBy(asc(lists.label)),
    listProfessionals(),
    getAgendaMode(),
  ]);
  return <OnlineBookingSettings value={value} services={services} pros={pros.map((p) => ({ id: p.id, name: p.name }))} agendaMode={mode} link={`${clientLinkBase()}/agendar`} />;
}
