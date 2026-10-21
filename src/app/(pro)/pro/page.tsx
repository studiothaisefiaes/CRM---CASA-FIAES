import { requirePro } from "@/server/auth/pro-session";
import { clientCard, getProDay } from "@/server/queries/pro";
import { todayBahia } from "@/lib/agenda";
import { minuteIn, pickNext, todayHeader } from "@/lib/pro-day";
import { DayView } from "@/components/pro/day-view";
import { NextClientCard } from "@/components/pro/next-client-card";

export const metadata = { title: "Hoje" };

export default async function ProTodayPage({ searchParams }: PageProps<"/pro">) {
  const { pro } = await requirePro();
  if (!pro) return null; // o layout já mostra "Sua conta ainda não está ligada…"
  const sp = await searchParams;
  const now = new Date();
  const today = todayBahia(now);
  const day = await getProDay(pro, today);
  const next = pickNext(day.items, minuteIn(now.getTime()));
  const card = next ? await clientCard(next, now) : null;
  const h = todayHeader({ name: pro.name, nowMs: now.getTime(), day: today, clients: day.items.filter((i) => i.status !== "faltou").length, ranges: day.ranges });
  return (
    <main className="flex flex-col gap-5">
      {sp.aviso === "sem-permissao" && <p role="status" className="rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm text-graphite">Você não tem acesso a essa tela. Aqui fica a sua agenda.</p>}
      <header>
        <h1 className="font-display text-xl leading-tight">{h.greeting}</h1>
        <p className="mt-1 text-graphite">{h.line}</p>
      </header>
      {next && card
        ? <NextClientCard item={next} card={card} nowMs={now.getTime()} />
        : <p className="rounded-[var(--radius-card)] border border-line bg-paper-2/60 px-4 py-5 text-graphite">{day.ranges.length ? "Nenhuma cliente pela frente hoje." : "Hoje é folga."}</p>}
      <DayView day={day} highlight={typeof sp.h === "string" ? sp.h : null} />
    </main>
  );
}
