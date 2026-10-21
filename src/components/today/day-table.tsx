"use client";
import { useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { setAppointmentStatusAction } from "@/app/(app)/agenda/actions";
import { DayVisitSheet } from "@/components/agenda/day-visit";
import { useComanda } from "@/components/caixa/comanda-provider";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { VIEW_STATUS } from "@/lib/agenda-day";
import type { AgendaMode } from "@/lib/agenda-settings";
import { serviceView, visitAction, visitColumn, visitSituation, type DayVisit, type VisitColumn } from "@/lib/day-visit";
import { cn } from "@/lib/cn";

type DayFilter = "todas" | VisitColumn;
const FILTERS: { value: DayFilter; label: string }[] = [
  { value: "todas", label: "Todas" }, { value: "a_chegar", label: "A chegar" }, { value: "na_casa", label: "Na Casa" },
  { value: "finalizou", label: "Finalizaram" }, { value: "nao_veio", label: "Não vieram" },
];
const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Bahia" });
const PLANNED = ["agendado", "confirmado"];

/**
 * A tabela do dia (Hoje v3, protótipo aprovado em 17/10), dentro do painel "O dia na Casa": uma linha por cliente, na ordem da hora, com
 * abas por situação. Serviços em etiquetas (bolinha na cor do estado, as cores da Agenda, e a profissional). A ação fica na linha: Chegou
 * (a visita toda), Receber (só com o caixa no CRM) ou Abrir. Tocar na linha abre a visita de hoje (de onde sai a comanda).
 */
export function DayTable({ visits, nowMs, caixaOn, canMark, agendaMode }: { visits: DayVisit[]; nowMs: number; caixaOn: boolean; canMark: boolean; agendaMode: AgendaMode }) {
  const [filter, setFilter] = useState<DayFilter>("todas");
  const [opened, setOpened] = useState<DayVisit | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();
  const comanda = useComanda();
  const count = (f: DayFilter) => (f === "todas" ? visits.length : visits.filter((v) => visitColumn(v) === f).length);
  const list = filter === "todas" ? visits : visits.filter((v) => visitColumn(v) === filter);

  const arrive = (v: DayVisit) => start(async () => {
    const first = v.services.find((s) => PLANNED.includes(s.status));
    if (!first) return;
    const r = await setAppointmentStatusAction(first.appointmentId, "chegou");
    if (!r.ok) { toast(r.error, "error"); return; }
    toast(`${v.name} chegou`);
    router.refresh();
  });
  const receive = (v: DayVisit) => (v.comanda ? comanda?.openById(v.comanda.id) : comanda?.openForAppointment(v.services[0].appointmentId));
  const onKey = (e: KeyboardEvent, v: DayVisit) => { if (e.key === "Enter" && e.target === e.currentTarget) setOpened(v); };

  return (
    <section aria-label="Clientes de hoje" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 max-w-full overflow-x-auto">
          <Tabs<DayFilter> idPrefix="dia" label="Filtrar por situação" value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ ...f, count: count(f.value) }))} className="w-max [&_button]:whitespace-nowrap" />
        </div>
        <p className="text-xs text-muted">ordenado pela hora · toque na linha para abrir</p>
      </div>
      <div id="dia-panel" role="tabpanel" aria-labelledby={`dia-tab-${filter}`} className="overflow-x-auto rounded-[var(--radius-card)] border border-line">
        {/* No celular, cada linha vira um cartão: hora, nome e ação no alto, situação embaixo do nome e os serviços por último (nada some para o lado). */}
        <table className="w-full border-collapse text-sm sm:min-w-[720px] max-sm:block">
          <thead className="max-sm:hidden">
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-3 py-2 font-medium">Hora</th><th className="px-3 py-2 font-medium">Cliente</th><th className="px-3 py-2 font-medium">Serviços e profissionais</th>
              <th className="px-3 py-2 font-medium">Situação</th><th className="px-3 py-2 text-right font-medium"><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody className="max-sm:block">
            {list.map((v) => {
              const sit = visitSituation(v, nowMs, { caixaOn });
              const action = visitAction(v, { caixaOn, canReceive: !!comanda });
              const col = visitColumn(v);
              const services = v.services.length ? v.services : v.cancelled;
              return (
                <tr key={v.key} data-testid="dia-linha" tabIndex={0} onClick={() => setOpened(v)} onKeyDown={(e) => onKey(e, v)}
                  className={cn("cursor-pointer border-b border-line/70 align-middle last:border-b-0 max-sm:grid max-sm:grid-cols-[3.25rem_minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-2 max-sm:gap-y-1 max-sm:px-3 max-sm:py-2.5 hover:bg-paper-2/70 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                    (col === "finalizou" || col === "nao_veio") && "text-graphite")}>
                  <td className="w-16 px-3 py-2.5 font-semibold tabular max-sm:col-start-1 max-sm:row-start-1 max-sm:w-auto max-sm:p-0">{HORA.format(new Date(v.entry))}</td>
                  <td className="min-w-[160px] px-3 py-2.5 font-semibold max-sm:col-start-2 max-sm:row-start-1 max-sm:min-w-0 max-sm:p-0">{v.name}</td>
                  <td className="px-3 py-2.5 max-sm:col-span-3 max-sm:row-start-3 max-sm:p-0 max-sm:pt-1">
                    <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                      {services.map((s) => (
                        <span key={s.appointmentId} data-testid="dia-servico" className="inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-[7px] max-sm:whitespace-normal border border-line bg-paper-2/60 px-2 py-0.5 text-[12.5px]">
                          <i aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: VIEW_STATUS[serviceView(s.status)].bar }} />
                          {s.service}<span className="font-medium text-graphite">{s.pro ?? ""}</span>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 max-sm:col-start-2 max-sm:row-start-2 max-sm:p-0">
                    {sit.late ? <span className="whitespace-nowrap text-xs font-semibold text-gold-ink">{sit.label}</span> : (
                      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={{ background: VIEW_STATUS[sit.tone!].bg, color: VIEW_STATUS[sit.tone!].fg }}>{sit.label}</span>
                        {sit.detail && <span className="whitespace-nowrap text-xs text-graphite">{sit.detail}</span>}
                      </span>
                    )}
                  </td>
                  <td className="w-28 px-3 py-2 text-right max-sm:col-start-3 max-sm:row-span-2 max-sm:row-start-1 max-sm:w-auto max-sm:p-0" onClick={(e) => e.stopPropagation()}>
                    {action === "chegou" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => arrive(v)} aria-label={`Chegou: ${v.name}`}>Chegou</Button>}
                    {action === "receber" && <Button size="sm" variant="gold" onClick={() => receive(v)} aria-label={`Receber: ${v.name}`}>Receber</Button>}
                    {action === "abrir" && <Button size="sm" variant="ghost" onClick={() => setOpened(v)} aria-label={`Abrir: ${v.name}`}>Abrir</Button>}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr className="max-sm:block"><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted max-sm:block">Ninguém aqui.</td></tr>}
          </tbody>
        </table>
      </div>
      {opened && <DayVisitSheet appointmentId={(opened.services[0] ?? opened.cancelled[0]).appointmentId} initial={{ visit: opened, canMark, agendaMode }} open onClose={() => setOpened(null)} nowMs={nowMs} />}
    </section>
  );
}
