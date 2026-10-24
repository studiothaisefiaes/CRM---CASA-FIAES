import Link from "next/link";
import type { AgendaPendingItem } from "@/server/queries/agenda-pending";

/** Hoje › Recepção: as pendências da Agenda à vista (dono 24/10: fora do sino). Cada uma abre a aba dela na Agenda. */
export function AgendaPendingStrip({ items }: { items: AgendaPendingItem[] }) {
  return (
    <section aria-label="Pendências da agenda" className="flex flex-wrap items-center gap-1.5">
      <h2 className="mr-1 text-sm font-medium text-graphite">Pendências da agenda</h2>
      {items.length ? items.map((i) => (
        <Link key={i.key} href={i.href}
          className={i.key === "semBaixa" ? "inline-flex min-h-11 items-center gap-2 rounded-full bg-alert-soft px-4 text-base font-medium text-alert hover:brightness-95"
            : "inline-flex min-h-11 items-center gap-2 rounded-full bg-paper-2 px-4 text-base font-medium text-ink-2 hover:bg-paper-3"}>
          {i.label} <span className="tabular font-semibold">{i.n}</span>
        </Link>
      )) : <span className="text-sm text-muted">nada pendente.</span>}
    </section>
  );
}
