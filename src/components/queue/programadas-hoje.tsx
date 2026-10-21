import Link from "next/link";
import { IconClock } from "@/components/icons";
import { displayName } from "@/lib/display-name";
import type { ScheduledList } from "@/server/queries/scheduled-list";

const hm = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Bahia", hour: "2-digit", minute: "2-digit" });

/** Bloco do Hoje: as mensagens que saem sozinhas hoje (até 5) e o caminho para Mensagens programadas. Sem nenhuma pendente, não aparece. */
export function ProgramadasHoje({ today, total }: { today: ScheduledList["pending"]; total: number }) {
  if (!total) return null;
  return (
    <section aria-labelledby="h-programadas" className="rounded-[var(--radius-panel)] border border-line bg-paper px-5 py-4">
      <header className="flex items-center justify-between gap-3">
        <h2 id="h-programadas" className="flex items-center gap-2 text-base font-semibold">
          <span className="text-gold"><IconClock size={16} /></span>Mensagens programadas<span className="font-normal text-muted tabular">{today.length || ""}</span>
        </h2>
        <Link href="/atendimento/programadas" className="text-sm text-gold-ink hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">Ver todas ({total})</Link>
      </header>
      {today.length === 0 ? <p className="mt-2 text-sm text-muted">Nenhuma sai hoje.</p> : (
        <ul className="mt-2 flex flex-col">
          {today.slice(0, 5).map((r) => (
            <li key={r.id}>
              <Link href={`/atendimento?lead=${r.dealId}`} className="-mx-2 flex min-h-10 items-center gap-3 rounded-[8px] px-2 text-sm hover:bg-paper-2 pointer-coarse:min-h-11">
                <span className="w-11 shrink-0 tabular text-graphite">{hm(r.sendAt)}</span>
                <span className="shrink-0 font-medium text-ink">{displayName(r.name).split(" ").slice(0, 2).join(" ")}</span>
                <span className="min-w-0 truncate text-muted">{r.text}</span>
              </Link>
            </li>
          ))}
          {today.length > 5 && <li className="pt-1 text-xs text-muted">e mais {today.length - 5} hoje</li>}
        </ul>
      )}
    </section>
  );
}
