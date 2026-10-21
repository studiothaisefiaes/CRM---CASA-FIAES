import Link from "next/link";
import { requirePro } from "@/server/auth/pro-session";
import { getProWeek } from "@/server/queries/pro";
import { todayBahia } from "@/lib/agenda";
import { dayTitle } from "@/lib/pro-day";

export const metadata = { title: "Semana" };

export default async function ProWeekPage() {
  const { pro } = await requirePro();
  if (!pro) return null;
  const today = todayBahia(new Date());
  const week = await getProWeek(pro, today);
  return (
    <main>
      <h1 className="font-display text-xl">Semana</h1>
      <ul className="mt-3 flex flex-col gap-2">
        {week.map((w) => (
          <li key={w.day}>
            <Link href={`/pro/dia/${w.day}`} className="flex min-h-12 items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line px-3 py-2 hover:bg-paper-2">
              <span>{w.day === today ? "Hoje · " : ""}{dayTitle(w.day)}</span>
              <span className="text-sm text-graphite">{w.off && !w.clients ? "Folga" : w.clients === 1 ? "1 cliente" : `${w.clients} clientes`}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
