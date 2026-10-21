import Link from "next/link";
import type { WeekRow } from "@/server/queries/agenda-week";
import { durationLabel } from "@/lib/agenda";
import { Empty } from "@/components/ui/empty";
import { cn } from "@/lib/cn";

const SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const clientsText = (n: number) => `${n} ${n === 1 ? "cliente" : "clientes"}`;

/** Semana por profissional (6.1): uma linha por profissional, uma coluna por dia; tocar abre o dia dela na visão Profissionais. */
export function WeekByPro({ rows, days, today }: { rows: WeekRow[]; days: string[]; today: string }) {
  if (!rows.length) return (
    <div className="rounded-[var(--radius-panel)] border border-line bg-paper"><Empty title="Nenhuma profissional cadastrada">Cadastre em Configurações › Profissionais.</Empty></div>
  );
  return (
    <div className="scroll-thin overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-paper">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <caption className="sr-only">Semana por profissional</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-paper px-3 py-2.5 text-left font-medium text-graphite">Profissional</th>
            {days.map((d) => (
              <th key={d} scope="col" className={cn("px-2 py-2.5 text-center font-medium capitalize", d === today ? "text-gold-ink" : "text-graphite")}>
                {SEMANA.format(new Date(`${d}T12:00:00Z`)).replace(".", "")} {Number(d.slice(8))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.professionalId} className="border-t border-line/70">
              <th scope="row" className="sticky left-0 z-10 bg-paper px-3 py-2 text-left font-medium">{r.name}{!r.active && <span className="ml-1 text-xs text-muted">(desativada)</span>}</th>
              {r.cells.map((c) => (
                <td key={c.day} className="px-1 py-1 text-center">
                  <Link href={`/agenda?d=${c.day}&v=profissionais&p=${r.professionalId}`}
                    aria-label={`${r.name}, ${c.day}: ${c.clients ? `${clientsText(c.clients)}, ${durationLabel(c.minutes)}` : c.off ? "folga" : "livre"}`}
                    className={cn("flex min-h-11 flex-col items-center justify-center rounded-[var(--radius-control)] hover:bg-paper-2", c.off && !c.clients && "bg-paper-2/60 text-muted")}>
                    {c.clients
                      ? <><span className="font-semibold tabular">{clientsText(c.clients)}</span><span className="text-xs text-muted tabular">{durationLabel(c.minutes)}</span></>
                      : <span>{c.off ? "Folga" : "livre"}</span>}
                  </Link>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
