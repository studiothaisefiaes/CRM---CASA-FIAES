import Link from "next/link";
import type { ProDay } from "@/server/queries/pro";
import { dayTimeline, hhmm, PRO_STATUS_LABEL } from "@/lib/pro-day";
import { durationLabel } from "@/lib/agenda";
import { cn } from "@/lib/cn";

/** A linha do dia: horários, livres e bloqueios. Os atendimentos feitos ficam recolhidos ("3 feitos"). */
export function DayView({ day, highlight }: { day: ProDay; highlight?: string | null }) {
  const byId = new Map(day.items.map((i) => [i.id, i]));
  const done = day.items.filter((i) => i.status === "compareceu");
  const rows = dayTimeline({ ranges: day.ranges, appts: day.items.map((i) => ({ id: i.id, start: i.start, durationMin: i.durationMin, status: i.status })), blocks: day.blocks })
    .filter((r) => r.kind !== "horario" || byId.get(r.id)?.status !== "compareceu");
  if (!rows.length && !done.length) return <p className="text-graphite">{day.ranges.length ? "Nenhum horário marcado." : "Folga"}</p>;
  return (
    <section aria-label="Linha do dia" className="flex flex-col gap-2">
      {done.length > 0 && (
        <details className="rounded-[var(--radius-control)] border border-line bg-paper-2/60 px-3">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm text-graphite">{done.length} {done.length === 1 ? "feito" : "feitos"}</summary>
          <ul className="flex flex-col gap-1 pb-2">
            {done.map((i) => <li key={i.id}><Link className="inline-flex min-h-11 items-center text-sm underline-offset-4 hover:underline" href={`/pro/horario/${i.id}`}>{hhmm(i.start)} · {i.clientName} · {i.service}</Link></li>)}
          </ul>
        </details>
      )}
      <ol className="flex flex-col gap-2">
        {rows.map((r) => {
          if (r.kind === "livre") return <li key={`livre-${r.start}`} className="rounded-[var(--radius-control)] border border-dashed border-line px-3 py-2 text-sm text-graphite">Livre {hhmm(r.start)}–{hhmm(r.end)}</li>;
          if (r.kind === "bloqueio") return <li key={r.id} className={cn("rounded-[var(--radius-control)] bg-paper-2 px-3 py-2 text-sm", r.pending ? "text-gold-ink" : "text-graphite")}>{r.title} {hhmm(r.start)}–{hhmm(r.end)}</li>;
          const i = byId.get(r.id)!;
          return (
            <li key={i.id}>
              <Link href={`/pro/horario/${i.id}`} aria-current={highlight === i.id ? "true" : undefined}
                className={cn("flex min-h-12 flex-col rounded-[var(--radius-card)] border border-line bg-paper px-3 py-2 hover:bg-paper-2", highlight === i.id && "ring-2 ring-gold", i.status === "faltou" && "opacity-70")}>
                <span className="flex items-baseline justify-between gap-2"><span className="font-semibold tabular">{hhmm(i.start)}</span><span className="text-xs text-graphite">{PRO_STATUS_LABEL[i.status] ?? i.status}</span></span>
                <span className="truncate">{i.clientName}</span>
                <span className="truncate text-sm text-graphite">{i.service} · {i.durationMin ? durationLabel(i.durationMin) : "duração não informada"}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
