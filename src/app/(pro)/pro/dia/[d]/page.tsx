import { notFound } from "next/navigation";
import { requirePro } from "@/server/auth/pro-session";
import { getProDay } from "@/server/queries/pro";
import { rangesLabel } from "@/lib/pro-day";
import { DayPager } from "@/components/pro/day-pager";
import { DayView } from "@/components/pro/day-view";
import { AckButton } from "@/components/pro/ack-button";
import { dayAcks } from "@/server/domain/pro/acks";
import { shiftDay, todayBahia } from "@/lib/agenda";

export const metadata = { title: "Dia" };
const validDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

export default async function ProDayPage({ params, searchParams }: PageProps<"/pro/dia/[d]">) {
  const { pro } = await requirePro();
  if (!pro) return null;
  const { d } = await params;
  if (!validDay(d)) notFound();
  const sp = await searchParams;
  const day = await getProDay(pro, d);
  const n = day.items.filter((i) => i.status !== "faltou").length;
  const tomorrow = shiftDay(todayBahia(new Date()), 1);
  const ack = (await dayAcks(d))[pro.professionalId] ?? null;
  return (
    <DayPager day={d}>
      <p className="text-center text-graphite">{rangesLabel(day.ranges)} · {n === 1 ? "1 cliente" : `${n} clientes`}</p>
      {d === tomorrow && <AckButton day={d} ack={ack} />}
      {d !== tomorrow && ack?.changedAfter && <p role="status" className="text-center text-sm font-medium text-alert">A agenda deste dia mudou depois que você viu.</p>}
      <DayView day={day} highlight={typeof sp.h === "string" ? sp.h : null} />
    </DayPager>
  );
}
