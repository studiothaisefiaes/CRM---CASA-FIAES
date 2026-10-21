"use client";
import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import type { AgendaItem } from "@/server/queries/agenda";
import { dayOf, durationLabel, STATUS_LABEL } from "@/lib/agenda";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { Empty } from "@/components/ui/empty";
import { IconCheck, IconClose } from "@/components/icons";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { conversationWith } from "@/lib/authorship";
import { shownName, useAgendaActions } from "./use-agenda-actions";
import { AvecTag, EDGE, MINI, StatusChip } from "./status-chip";
import { EntrySheet } from "./entry-sheet";
import { PreferenceTag } from "./preference-tag";
import { MarkerTags } from "./marker-fields";
import { FIRST_VISIT_LABEL } from "@/lib/visit-type";
import { canBookIn, useAgendaSheets } from "./agenda-sheets";
import { ACTIVE_STATUSES } from "@/lib/appointment-status";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const SEMANA = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

const first = (n: string | null) => n?.split(" ")[0] ?? null;
const detail = (i: AgendaItem) => [
  i.service, i.professionalName ? `com ${first(i.professionalName)}` : null,
  i.source === "lead" ? conversationWith(i.ownerName) : null,
].filter(Boolean).join(" · ");

/**
 * Dia: a lista por horário (com a linha do agora, hoje). Semana: sete colunas no computador; no celular, um dia embaixo do outro.
 * Lead abre a conversa; agendamento (Avec ou da Casa) abre a folha do horário, com Compareceu/Faltou/Cancelar.
 */
export function AgendaBoard({ items, view, days, today, nowMs, pro = null, highlight = null }: { items: AgendaItem[]; view: "lista" | "semana"; days: string[]; today: string; nowMs: number; pro?: string | null; highlight?: string | null }) {
  const actions = useAgendaActions(nowMs); const { pending, mark, apply } = actions; const { catalog } = useAgendaSheets();
  const [openKey, setOpenKey] = useState<string | null>(null);
  const list = apply(items);
  const opened = list.find((i) => i.key === openKey) ?? null;
  const sheet = <EntrySheet item={opened} onClose={() => setOpenKey(null)} actions={actions} nowMs={nowMs} visitCount={opened?.visitId ? list.filter((x) => x.visitId === opened.visitId && ACTIVE_STATUSES.includes(x.dbStatus ?? "")).length : 1} />;
  useEffect(() => { if (highlight) document.querySelector(`[data-highlight="true"]`)?.scrollIntoView({ block: "center", inline: "center" }); }, [highlight]);

  if (view === "lista") {
    if (!list.length) return (
      <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
        <Empty title="Nenhum horário marcado neste dia">{canBookIn(catalog) ? "Toque em Marcar, no alto da página." : "Para marcar, abra a conversa da cliente e use “Agendar”."}</Empty>
      </div>
    );
    const nowLine = days[0] === today ? list.findIndex((i) => new Date(i.scheduledAt).getTime() > nowMs) : -1;
    return (
      <>
        <ol className="rounded-[var(--radius-panel)] border border-line bg-paper" aria-label="Horários do dia">
          {list.map((i, k) => {
            const off = i.status === "cancelado";
            const who = (
              <>
                {i.contactId ? <ContactAvatar contactId={i.contactId} hasAvatar={i.hasAvatar} name={shownName(i)} size={40} />
                  : <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full bg-paper-3 text-sm font-semibold text-graphite">{initials(i.name)}</span>}
                <span className="min-w-0 text-left">
                  <span className="flex items-center gap-2">
                    <span className={cn("truncate text-base font-medium", off && "text-muted line-through")}>{shownName(i)}</span>
                    {i.origin === "avec" && <AvecTag />}
                    {i.fitIn && <span className="rounded-[4px] bg-alert-soft px-1 text-xs font-semibold text-alert">encaixe</span>}{i.firstVisit && <span className="rounded-[4px] bg-paper-3 px-1 text-xs font-semibold text-graphite">{FIRST_VISIT_LABEL}</span>}<MarkerTags item={i} />{i.paid && <span title="Comanda fechada" className="rounded-[4px] bg-ok-soft px-1 text-xs font-semibold text-ok">R$</span>}{i.openComandaId && !i.paid && <span title="Comanda aberta" className="rounded-[4px] bg-gold-soft px-1 text-xs font-semibold text-gold-ink">falta fechar</span>}<PreferenceTag value={i.preference} />
                  </span>
                  <span className="block truncate text-sm text-graphite">{detail(i) || "Serviço não informado"}</span>
                </span>
              </>
            );
            const whoCls = "flex min-h-11 min-w-0 flex-1 basis-48 items-center gap-3 rounded-[var(--radius-control)] hover:text-gold-ink";
            return (
              <Fragment key={i.key}>
                {k === nowLine && <NowLine nowMs={nowMs} />}
                <li className={cn("flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line/70 px-4 py-3 first:border-t-0 sm:px-5", off && "bg-paper-2/40", !!highlight && i.appointmentId === highlight && "ring-2 ring-inset ring-gold")} data-testid="agenda-item"
                  data-highlight={(!!highlight && i.appointmentId === highlight) || undefined}>
                  <span className="flex w-14 shrink-0 flex-col">
                    <span className={cn("text-lg font-semibold tabular", off && "text-muted line-through")}>{i.noTime ? "—" : HORA.format(new Date(i.scheduledAt))}</span>
                    <span className="text-xs text-muted tabular" title={i.durationEstimated ? "Duração estimada: o serviço não tem duração cadastrada" : undefined}>
                      {i.noTime ? "sem hora" : `${i.durationEstimated ? "~" : ""}${durationLabel(i.durationMin)}`}
                    </span>
                  </span>
                  <button type="button" onClick={() => setOpenKey(i.key)} className={whoCls} aria-haspopup="dialog">{who}</button>
                  {i.status === "conferir" ? (
                    <span className="flex gap-2">
                      {([["compareceu", i.source === "lead" ? "Veio" : "Finalizar", IconCheck], ["faltou", "Faltou", IconClose]] as const).map(([value, label, Icon]) => (
                        <button key={value} type="button" disabled={pending} onClick={() => mark(i, value)} aria-label={`${label}: ${shownName(i)}`}
                          className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors disabled:opacity-60",
                            value === "compareceu" ? "border-ok/40 text-ok hover:bg-ok-soft" : "border-alert/40 text-alert hover:bg-alert-soft")}>
                          <Icon size={14} aria-hidden />{label}
                        </button>
                      ))}
                    </span>
                  ) : <StatusChip status={i.status} />}
                </li>
              </Fragment>
            );
          })}
          {nowLine === -1 && days[0] === today && <NowLine nowMs={nowMs} last />}
        </ol>
        {sheet}
      </>
    );
  }

  const byDay = new Map(days.map((d) => [d, [] as AgendaItem[]]));
  for (const i of list) byDay.get(dayOf(i.scheduledAt))?.push(i);
  return (
    <>
      <div className="grid gap-3 lg:grid-cols-7 lg:gap-2" aria-label="Horários da semana">
        {days.map((d) => {
          const its = byDay.get(d)!;
          const live = its.filter((i) => i.status !== "cancelado").length;
          const isToday = d === today;
          return (
            <section key={d} aria-label={d} className={cn("flex min-w-0 flex-col rounded-[var(--radius-panel)] border bg-paper lg:min-h-[420px]", isToday ? "border-gold" : "border-line")}>
              <header className={cn("flex items-baseline justify-between gap-2 border-b px-3 py-2.5", isToday ? "border-gold/40 bg-gold-soft/60" : "border-line")}>
                <Link href={`/agenda?d=${d}${pro ? `&p=${pro}` : ""}`} className="flex items-baseline gap-1.5 hover:text-gold-ink">
                  <span className="text-sm capitalize text-graphite">{SEMANA.format(new Date(`${d}T12:00:00Z`)).replace(".", "")}</span>
                  <span className="text-lg font-semibold tabular">{Number(d.slice(8))}</span>
                  {isToday && <span className="text-xs font-semibold text-gold-ink">hoje</span>}
                </Link>
                <span className="text-sm text-muted tabular">{live || ""}</span>
              </header>
              {its.length === 0 ? <p className="px-3 py-3 text-sm text-muted">Livre</p> : (
                <ul className="flex flex-col gap-1.5 p-2">
                  {its.map((i) => {
                    const off = i.status === "cancelado";
                    const body = (
                      <>
                        <span className="flex items-baseline justify-between gap-2">
                          <span className={cn("text-sm font-semibold tabular", off && "text-muted line-through")}>{i.noTime ? "sem hora" : HORA.format(new Date(i.scheduledAt))}</span>
                          {MINI[i.status] && <span className={cn("text-xs font-semibold", MINI[i.status])}>{STATUS_LABEL[i.status].toLowerCase()}</span>}
                        </span>
                        <span className={cn("block truncate text-sm font-medium", off && "text-muted line-through")}>{shownName(i)}</span>
                        {(i.service || i.professionalName) && <span className="block truncate text-xs text-graphite">{[i.service, i.professionalName && `com ${first(i.professionalName)}`].filter(Boolean).join(" · ")}</span>}
                      </>
                    );
                    const cls = cn("block w-full rounded-[var(--radius-control)] border border-line border-l-[3px] bg-paper px-2.5 py-2 text-left transition-colors hover:bg-paper-2", EDGE[i.status], off && "opacity-70");
                    return (
                      <li key={i.key}>
                        <button type="button" onClick={() => setOpenKey(i.key)} className={cls} aria-haspopup="dialog">{body}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {sheet}
    </>
  );
}

function NowLine({ nowMs, last = false }: { nowMs: number; last?: boolean }) {
  return (
    <li aria-label={`Agora, ${HORA.format(new Date(nowMs))}`} className={cn("flex items-center gap-3 px-4 sm:px-5", last ? "py-3" : "-my-px py-1")}>
      <span className="w-14 shrink-0 text-xs font-semibold text-gold-ink tabular">{HORA.format(new Date(nowMs))}</span>
      <span className="h-0.5 flex-1 rounded bg-gold" />
      <span className="text-xs font-semibold text-gold-ink">agora</span>
    </li>
  );
}
