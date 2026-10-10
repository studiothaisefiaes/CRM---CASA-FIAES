import Link from "next/link";
import type { QueueCounts } from "@/server/queries/queue";
import { queueHref } from "@/lib/queue";
import { cn } from "@/lib/cn";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 aguardando · 3 atrasados · 5 agendados hoje": cada número é um link que filtra a Fila (clicar de novo tira o filtro). */
export function QueueSummary({ counts, view, filtro }: { counts: QueueCounts; view: string; filtro: string | null }) {
  const items = [
    { key: "esperando", label: plural(counts.aguardando, "aguardando", "aguardando"), href: queueHref({ filtro: "esperando" }), on: filtro === "esperando", tone: "" },
    { key: "atrasados", label: plural(counts.atrasados, "atrasado", "atrasados"), href: queueHref({ filtro: "atrasados" }), on: filtro === "atrasados", tone: counts.atrasados ? "text-alert font-semibold" : "" },
    { key: "agendados-hoje", label: plural(counts.agendadosHoje, "agendado hoje", "agendados hoje"), href: queueHref({ view: "agendados-hoje" }), on: view === "agendados-hoje" && !filtro, tone: "" },
  ];
  return (
    <p className="mt-2.5 flex flex-wrap items-center gap-x-0.5 text-sm lg:text-[13px] text-graphite" aria-label="Resumo da fila">
      {items.map((it, i) => (
        <span key={it.key} className="inline-flex items-center gap-1">
          <Link href={it.on ? queueHref({ view: "todos" }) : it.href} replace scroll={false} aria-current={it.on ? "true" : undefined}
            className={cn("inline-flex items-center min-h-11 lg:min-h-8 px-1.5 rounded-[var(--radius-control)] tabular hover:bg-paper-2 hover:text-ink", it.tone, it.on && "bg-ink text-paper hover:bg-ink hover:text-paper")}>
            {it.label}
          </Link>
          {i < items.length - 1 && <span aria-hidden className="text-muted">·</span>}
        </span>
      ))}
    </p>
  );
}
