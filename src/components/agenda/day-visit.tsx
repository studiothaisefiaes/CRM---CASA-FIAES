"use client";
import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { dayVisitAction, setAppointmentStatusAction, undoManyAction } from "@/app/(app)/agenda/actions";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { useComanda } from "@/components/caixa/comanda-provider";
import { VIEW_STATUS } from "@/lib/agenda-day";
import { dayOf, todayBahia } from "@/lib/agenda";
import { canMarkNoShow, checkCancel } from "@/lib/appointment-status";
import { passedText, SERVICE_STATE, serviceView, visitColumn, visitLateMin, visitTotal, type DayVisit, type DayVisitService } from "@/lib/day-visit";
import { money } from "@/lib/format";
import { leadHref } from "@/lib/lead-href";
import type { AgendaMode } from "@/lib/agenda-settings";
import { canBookIn, useAgendaSheets } from "./agenda-sheets";
import { CancelSheet } from "./cancel-sheet";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Bahia" });
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
const hora = (iso: string) => HORA.format(new Date(iso));
const PLANNED = ["agendado", "confirmado"];

export type DayVisitData = { visit: DayVisit | null; canMark: boolean; agendaMode: AgendaMode };

/** Carrega a visita do dia do horário (e recarrega depois de cada ação). */
export function useDayVisit(appointmentId: string | null, initial?: DayVisitData | null) {
  const [data, setData] = useState<DayVisitData | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const apply = useCallback((r: Awaited<ReturnType<typeof dayVisitAction>>) => { if (r.ok) { setData(r.data!); setError(null); } else setError(r.error); }, []);
  const reload = useCallback(async () => { if (appointmentId) apply(await dayVisitAction(appointmentId)); }, [appointmentId, apply]);
  useEffect(() => {
    if (!appointmentId || initial) return;
    let alive = true;
    dayVisitAction(appointmentId).then((r) => { if (alive) apply(r); }).catch(() => { if (alive) setError("Não deu para abrir a visita. Tente de novo."); });
    return () => { alive = false; };
  }, [appointmentId, initial, apply]);
  return { data, error, reload };
}

/**
 * A visita do dia (17/10, "uma comanda de tudo que a pessoa vai fazer hoje"): os serviços da cliente no dia, com quem faz (e a assistente),
 * horário, estado (as cores da Agenda) e valor, o total, e as ações: Chegou (a visita toda), Começar e Finalizar por serviço, Faltou,
 * Remarcar e Cancelar. A comanda do Caixa, quando o caixa está no CRM, abre pelo botão de sempre ("Abrir comanda"/"Ver comanda").
 * `embedded`: dentro da folha do horário da Agenda (sem o cabeçalho, que a folha já tem).
 */
export function DayVisitView({ data, nowMs, onChanged, embedded, hideConversation }: {
  data: DayVisitData; nowMs: number; onChanged: () => void | Promise<void>; embedded?: boolean; hideConversation?: boolean;
}) {
  const { visit: v, canMark, agendaMode } = data;
  const [pending, start] = useTransition();
  const [cancelling, setCancelling] = useState<DayVisitService | null>(null);
  const toast = useToast();
  const router = useRouter();
  const sheets = useAgendaSheets();
  const confirmNoShow = useConfirmNoShow();
  const comanda = useComanda();
  if (!v) return null;
  const today = todayBahia(new Date(nowMs));
  const isToday = v.day === today;
  const planned = v.services.filter((s) => PLANNED.includes(s.status));
  const late = visitLateMin(v, nowMs);
  const total = visitTotal(v);
  const pros = [...new Set(v.services.map((s) => s.pro).filter((x): x is string => !!x))];
  const after = async (msg: string) => { toast(msg); await onChanged(); router.refresh(); };

  const mark = (s: DayVisitService, status: "chegou" | "em_atendimento" | "compareceu", msg: string) => start(async () => {
    const r = await setAppointmentStatusAction(s.appointmentId, status);
    if (!r.ok) { toast(r.error, "error"); return; }
    await after(msg);
  });
  // Faltou marca a visita toda: pede confirmação e o aviso tem Desfazer (QA r58, M-2).
  const noShow = () => confirmNoShow({ who: v.name, detail: planned.length > 1 ? `${planned.length} serviços` : planned[0]?.service ?? null, onConfirm: () => start(async () => {
    const done: string[] = [];
    for (const s of planned) {
      const r = await setAppointmentStatusAction(s.appointmentId, "faltou");
      if (!r.ok) { toast(r.error, "error"); break; }
      done.push(s.appointmentId);
    }
    if (done.length) toast(`${v.name} faltou`, "ok", { label: "Desfazer", onClick: () => start(async () => {
      const u = await undoManyAction(done);
      if (!u.ok) { toast(u.error, "error"); return; }
      toast(u.data!.failed.length ? `Desfeito em ${u.data!.done.length}; ${u.data!.failed[0].error}` : "Desfeito");
      await onChanged(); router.refresh();
    }) });
    await onChanged(); router.refresh();
  }) });
  const canNoShow = planned.length > 0 && planned.length === v.services.length && planned.every((s) => canMarkNoShow({ status: s.status, startsAt: new Date(s.start) }, new Date(nowMs)));
  const cancelable = v.services.filter((s) => checkCancel(s.status).ok);
  const asItem = (s: DayVisitService) => ({
    appointmentId: s.appointmentId, name: v.name, scheduledAt: s.start, service: s.service, dealId: v.dealId, professionalId: s.professionalId, serviceId: s.serviceId,
    durationMin: s.end ? Math.round((new Date(s.end).getTime() - new Date(s.start).getTime()) / 60_000) : 60, durationEstimated: !s.end, contactId: v.contactId,
    preference: null, professionalName: s.assistant ?? s.pro,
  });
  const inAgenda = canBookIn(sheets.catalog);
  const reschedule = (s: DayVisitService) => sheets.reschedule(asItem(s));
  const stateOf = (s: DayVisitService) => VIEW_STATUS[serviceView(s.status)];

  return (
    <section aria-label={`Visita de ${v.name}`} className="flex flex-col gap-4">
      {!embedded && (
        <div>
          <p className="text-sm text-graphite">{isToday ? "Visita de hoje" : DIA.format(new Date(v.entry))} · entrada {hora(v.entry)}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-paper-2 px-3 py-1">{v.services.length} {v.services.length === 1 ? "serviço" : "serviços"}</span>
            {pros.length > 0 && <span className="rounded-full bg-paper-2 px-3 py-1">com {pros.join(", ")}</span>}
            {late && <span className="py-1 text-sm font-medium text-gold-ink">{passedText(late)}, sem Chegou</span>}
            {v.comanda && <span className="rounded-full bg-paper-2 px-3 py-1">Comanda {v.comanda.number}{v.comanda.status === "fechada" ? " · paga" : ""}</span>}
          </div>
        </div>
      )}
      {embedded && <h3 className="text-sm font-semibold text-graphite">Visita de {isToday ? "hoje" : "do dia"}: {v.services.length} {v.services.length === 1 ? "serviço" : "serviços"}</h3>}

      <div className="flex flex-wrap gap-2">
        {isToday && planned.length > 0 && <Button variant="gold" disabled={pending} onClick={() => mark(planned[0], "chegou", `${v.name} chegou`)}>Chegou{v.services.length > 1 ? " (a visita toda)" : ""}</Button>}
        {canNoShow && <Button variant="secondary" className="border-alert/40 text-alert hover:bg-alert-soft" disabled={pending} onClick={noShow}>Faltou</Button>}
        {canMark && cancelable.length > 0 && <Button variant="secondary" disabled={pending} onClick={() => setCancelling(cancelable[0])}>Cancelar horário</Button>}
        {comanda && v.services.some((s) => s.status !== "faltou") && (
          <Button variant="secondary" onClick={() => (v.comanda ? comanda.openById(v.comanda.id) : comanda.openForAppointment(v.services[0].appointmentId))}>
            {v.comanda ? (v.comanda.status === "aberta" ? "Receber / Fechar comanda" : "Ver comanda") : "Abrir comanda"}
          </Button>
        )}
        {!hideConversation && v.dealId && <Link href={leadHref(v.dealId)} className="inline-flex h-10 items-center px-2 text-sm font-medium text-gold-ink underline-offset-4 hover:underline pointer-coarse:min-h-11">Abrir conversa</Link>}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Serviço</th><th className="py-2 pr-3 font-medium">Quem faz</th><th className="py-2 pr-3 font-medium">Horário</th>
              <th className="py-2 pr-3 font-medium">Estado</th>{v.values && <th className="py-2 pr-3 text-right font-medium">Valor</th>}<th className="py-2"><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {v.services.map((s) => {
              const st = stateOf(s);
              return (
                <tr key={s.appointmentId} className="border-b border-line/70 align-top" data-testid="visita-servico">
                  <td className="py-2.5 pr-3 font-medium">{s.service}</td>
                  <td className="py-2.5 pr-3">{s.pro ?? "Não informada"}{s.assistant && <span className="block text-xs text-graphite">assistente: {s.assistant}</span>}</td>
                  <td className="py-2.5 pr-3 tabular whitespace-nowrap">{hora(s.start)}{s.end ? `–${hora(s.end)}` : ""}</td>
                  <td className="py-2.5 pr-3"><span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ background: st.bg, color: st.fg }}>{SERVICE_STATE[serviceView(s.status)]}</span></td>
                  {v.values && <td className="py-2.5 pr-3 text-right tabular">{s.priceCents != null ? money(s.priceCents) : <span className="text-muted">sem preço</span>}</td>}
                  <td className="py-2 text-right whitespace-nowrap">
                    {isToday && s.status === "chegou" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => mark(s, "em_atendimento", `${s.service}: atendendo`)}>Começar</Button>}
                    {s.status === "em_atendimento" && <Button size="sm" variant="secondary" disabled={pending} onClick={() => mark(s, "compareceu", `${s.service}: finalizado`)}>Finalizar</Button>}
                    {canMark && PLANNED.includes(s.status) && (inAgenda
                      ? <Button size="sm" variant="ghost" onClick={() => reschedule(s)}>Remarcar</Button>
                      : <Link href={`/agenda?d=${dayOf(s.start)}&destaque=${s.appointmentId}`} className="inline-flex h-8 items-center px-2 text-sm font-medium text-gold-ink underline-offset-4 hover:underline">Remarcar</Link>)}
                    {canMark && v.services.length > 1 && checkCancel(s.status).ok && <Button size="sm" variant="ghost" aria-label={`Cancelar ${s.service}`} onClick={() => setCancelling(s)}>Cancelar</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {v.values && total.totalCents != null && (
        <p className="flex items-baseline justify-between border-t border-line pt-2 text-base font-semibold">
          <span>Total{total.missing ? <span className="ml-2 text-sm font-normal text-muted">({total.missing} sem preço)</span> : null}</span>
          <span className="tabular">{money(total.totalCents)}</span>
        </p>
      )}
      {v.cancelled.length > 0 && <p className="text-sm text-muted">Cancelado hoje: {v.cancelled.map((s) => s.service).join(", ")}.</p>}
      {visitColumn(v) === "na_casa" && planned.length > 0 && <p className="text-xs text-muted">Os serviços que ainda não começaram ficam como estão até a profissional começar.</p>}
      {cancelling && (
        <CancelSheet open onClose={() => setCancelling(null)} item={asItem(cancelling)} visitCount={v.services.length} agendaMode={agendaMode}
          onDone={(r) => { setCancelling(null); void after(r.cancelled > 1 ? `${r.cancelled} horários cancelados` : "Horário cancelado"); }} />
      )}
    </section>
  );
}

/** A visita do dia num painel lateral (Hoje, conversa). Com `initial`, já abre com os dados (o quadro do Hoje). */
export function DayVisitSheet({ appointmentId, initial, open, onClose, nowMs, hideConversation }: {
  appointmentId: string | null; initial?: DayVisitData | null; open: boolean; onClose: () => void; nowMs: number; hideConversation?: boolean;
}) {
  const { data, error, reload } = useDayVisit(open ? appointmentId : null, initial);
  const name = data?.visit?.name ?? "Visita";
  return (
    <Sheet open={open} onClose={onClose} title={name}>
      {error && <p role="alert" className="text-sm text-alert">{error}</p>}
      {!data && !error && <p className="text-sm text-muted">Carregando…</p>}
      {data && !data.visit && <p className="text-sm text-graphite">Esse horário não está mais na Agenda.</p>}
      {data?.visit && <DayVisitView data={data} nowMs={nowMs} onChanged={reload} hideConversation={hideConversation} />}
    </Sheet>
  );
}
