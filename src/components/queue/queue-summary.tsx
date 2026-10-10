import Link from "next/link";
import type { QueueCounts } from "@/server/queries/queue";
import { queueHref, type QueueFoco } from "@/lib/queue";
import { cn } from "@/lib/cn";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "12 aguardando  3 atrasados  5 agendados hoje": cada número é um link que filtra a Fila pelo parâmetro `foco` (ou a view), com o mesmo escopo
 * dos números mostrados; clicar de novo tira o filtro. Sem "·" entre eles: em 340 px o resumo quebra de linha sem deixar separador pendurado.
 */
export function QueueSummary({ counts, view, foco, filtro }: { counts: QueueCounts; view: string; foco: QueueFoco | null; filtro: string | null }) {
  const items = [
    { key: "aguardando", label: plural(counts.aguardando, "aguardando", "aguardando"), href: queueHref({ foco: "aguardando" }), on: foco === "aguardando", tone: "" },
    { key: "atrasados", label: plural(counts.atrasados, "atrasado", "atrasados"), href: queueHref({ foco: "atrasados" }), on: foco === "atrasados", tone: counts.atrasados ? "text-alert font-semibold" : "" },
    { key: "agendados-hoje", label: plural(counts.agendadosHoje, "agendado hoje", "agendados hoje"), href: queueHref({ view: "agendados-hoje" }), on: view === "agendados-hoje" && !filtro && !foco, tone: "" },
  ];
  return (
    <p className="mt-2.5 flex flex-wrap items-center gap-x-1 text-sm lg:text-[13px] text-graphite" aria-label="Resumo da fila">
      {items.map((it) => (
        <Link key={it.key} href={it.on ? queueHref({ view: "todos" }) : it.href} replace scroll={false} aria-current={it.on ? "true" : undefined}
          className={cn("inline-flex items-center min-h-11 lg:min-h-8 px-2 rounded-[var(--radius-control)] tabular hover:bg-paper-2 hover:text-ink", it.tone, it.on && "bg-ink text-paper hover:bg-ink hover:text-paper")}>
          {it.label}
        </Link>
      ))}
    </p>
  );
}
