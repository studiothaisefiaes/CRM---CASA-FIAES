import { Fragment } from "react";
import { buttonClass } from "@/components/ui/button-styles";
import Link from "next/link";
import type { ClientCard, ProItem } from "@/server/queries/pro";
import { hhmm, PRO_STATUS_LABEL, untilLabel } from "@/lib/pro-day";
import { durationLabel } from "@/lib/agenda";

/** "10:00 · em 25 min · Paula Souza · Corte feminino · 1h20", com status, observações, última visita, pacote e selos. Nunca telefone nem valor. */
export function NextClientCard({ item, card, nowMs, label = "Próxima cliente", link = true }: { item: ProItem; card: ClientCard; nowMs: number; label?: string; link?: boolean }) {
  return (
    <section aria-label={label} className="rounded-[var(--radius-card)] border border-gold/50 bg-gold-soft/50 p-4">
      <p className="text-sm text-graphite"><span className="font-semibold tabular text-ink">{hhmm(item.start)}</span> · {untilLabel(new Date(item.startsAt).getTime(), nowMs)} · {PRO_STATUS_LABEL[item.status] ?? item.status}</p>
      <h2 className="mt-1 font-display text-xl leading-tight">{item.clientName}</h2>
      <p className="text-graphite">{item.service}{item.durationMin ? ` · ${durationLabel(item.durationMin)}` : ""}</p>
      {(card.firstVisit || card.birthdayThisWeek) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.firstVisit && <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-gold-ink">primeira vez</span>}
          {card.birthdayThisWeek && <span className="rounded-full bg-paper px-2 py-0.5 text-xs font-medium text-gold-ink">aniversário esta semana</span>}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
        {item.notes && <><dt className="text-graphite">Observação</dt><dd>{item.notes}</dd></>}
        {card.notes.map((n) => (
          <Fragment key={n.id}>
            <dt className="text-graphite">Ficha</dt>
            <dd>{n.body}{n.author ? <span className="text-graphite"> · {n.author}</span> : null}{n.hasPhoto ? <> · <a className="underline underline-offset-4" href={`/api/notas/${n.id}/foto`}>ver foto</a></> : null}</dd>
          </Fragment>
        ))}
        {card.lastVisit && <><dt className="text-graphite">Última visita</dt><dd>{card.lastVisit}</dd></>}
        {card.pkg && <><dt className="text-graphite">Pacote</dt><dd>{card.pkg}</dd></>}
      </dl>
      {link && <Link href={`/pro/horario/${item.id}`} className={buttonClass({ variant: "primary", size: "lg", className: "mt-4 w-full" })}>Abrir o horário</Link>}
    </section>
  );
}
