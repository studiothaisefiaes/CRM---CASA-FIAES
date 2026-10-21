"use client";
import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { AgendaItem } from "@/server/queries/agenda";
import { dayOf, minuteOfDay, timeRange, todayBahia } from "@/lib/agenda";
import { hm, NO_BAIXA_DAYS } from "@/lib/agenda-day";
import { durationLabel } from "@/lib/agenda";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { IconCheck } from "@/components/icons";
import { cn } from "@/lib/cn";
import { markManyAction, toWaitlistManyAction, undoManyAction } from "@/app/(app)/agenda/actions";
import { useComanda } from "@/components/caixa/comanda-provider";
import { shownName } from "../use-agenda-actions";
import { originLabel } from "../entry-sheet";
import { canBookIn, useAgendaSheets } from "../agenda-sheets";
import type { ConfirmByPhoneItem } from "@/server/queries/confirm-by-phone";
import { ConfirmByPhoneList } from "./confirm-by-phone";

export type PendingTab = "semBaixa" | "espera" | "pagar" | "pedidos" | "pagos" | "avec" | "telefone";
export type PendingData = {
  /** Da semana (os 7 dias até hoje): passou da hora e ninguém marcou Chegou (a maioria vem do Avec). */ noBaixa: AgendaItem[];
  waitlistCount: number; waitlist: ReactNode;
  /** Só com o caixa no CRM: finalizado hoje sem comanda fechada. */ faltaPagar: AgendaItem[];
  pedidosCount: number; pedidos: ReactNode;
  paidCount: number; /** Já pagaram (pacotes): carregado só quando a aba é aberta pela URL (?aba=pagos). */ paid: ReactNode | null; paidHref: string;
  avec: { count: number; content: ReactNode } | null;
  /** Confirmar por telefone (17/10): horário amanhã e sem conversa no CRM (sem lembrete). */ confirmByPhone?: { items: ConfirmByPhoneItem[]; canStart: boolean };
};

const WEEK = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "Hoje, quinta 16/10", "Ontem, quarta 15/10". */
const dayTitle = (d: string, today: string) => {
  const rel = d === today ? "Hoje" : Date.parse(today) - Date.parse(d) === 86_400_000 ? "Ontem" : null;
  const wd = WEEK.format(new Date(`${d}T12:00:00Z`)).replace("-feira", "");
  return `${rel ? `${rel}, ${wd}` : cap(wd)} ${d.slice(8, 10)}/${d.slice(5, 7)}`;
};
const first = (s: string | null) => s?.trim().split(/\s+/)[0] ?? "";

/**
 * O painel grande das pendências (~70% da tela, por cima): "Sem baixa" com Veio / Faltou / Remarcar um por um ou em lote, Lista de
 * espera, Falta pagar (caixa no CRM), Pedidos (folga e site), Já pagaram e Conferir com o Avec. Nunca uma coluna de cartõezinhos na tela.
 */
export function PendingPanel({ open, tab, onTab, onClose, data, nowMs }: { open: boolean; tab: PendingTab; onTab: (t: PendingTab) => void; onClose: () => void; data: PendingData; nowMs: number }) {
  const tabs: { value: PendingTab; label: string; n: number; href?: string }[] = [
    { value: "semBaixa", label: "Sem desfecho", n: data.noBaixa.length },
    { value: "espera", label: "Lista de espera", n: data.waitlistCount },
    ...(data.faltaPagar.length ? [{ value: "pagar" as const, label: "Falta pagar", n: data.faltaPagar.length }] : []),
    ...(data.pedidosCount ? [{ value: "pedidos" as const, label: "Pedidos", n: data.pedidosCount }] : []),
    { value: "pagos", label: "Já pagaram", n: data.paidCount, href: data.paid ? undefined : data.paidHref },
    ...(data.avec ? [{ value: "avec" as const, label: "Conferir com o Avec", n: data.avec.count }] : []),
    ...(data.confirmByPhone?.items.length ? [{ value: "telefone" as const, label: "Confirmar por telefone", n: data.confirmByPhone.items.length }] : []),
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Pendências da agenda" className="max-w-none sm:w-[min(100%,980px)] lg:w-[70%] lg:rounded-l-[var(--radius-panel)]">
      <div className="-mt-1 flex flex-col gap-5">
        <nav aria-label="Tipo de pendência" className="flex flex-wrap gap-1.5">
          {tabs.map((t) => {
            const cls = cn("inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-base font-medium", tab === t.value ? "bg-ink font-semibold text-paper" : "bg-paper-2 text-ink-2 hover:bg-paper-3");
            const inner = <>{t.label} <span className="tabular">{t.n}</span></>;
            return t.href ? <Link key={t.value} href={t.href} className={cls}>{inner}</Link>
              : <button key={t.value} type="button" aria-pressed={tab === t.value} className={cls} onClick={() => onTab(t.value)}>{inner}</button>;
          })}
        </nav>
        {tab === "semBaixa" && <NoBaixaList items={data.noBaixa} nowMs={nowMs} />}
        {tab === "espera" && data.waitlist}
        {tab === "pagar" && <PayList items={data.faltaPagar} />}
        {tab === "pedidos" && data.pedidos}
        {tab === "pagos" && data.paid}
        {tab === "avec" && data.avec?.content}
        {tab === "telefone" && data.confirmByPhone && <ConfirmByPhoneList items={data.confirmByPhone.items} canStart={data.confirmByPhone.canStart} />}
      </div>
    </Sheet>
  );
}

/** Sem baixa: agrupado por dia, com seleção para o lote. "Veio" = Finalizado (o pagamento segue onde estiver o caixa). */
export function NoBaixaList({ items, nowMs }: { items: AgendaItem[]; nowMs: number }) {
  const { catalog } = useAgendaSheets();
  const canBook = canBookIn(catalog);
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [chk, setChk] = useState<string[]>([]);
  const [gone, setGone] = useState<string[]>([]);
  const list = items.filter((i) => !gone.includes(i.appointmentId!));
  const ids = list.map((i) => i.appointmentId!);
  const checked = chk.filter((id) => ids.includes(id));
  const all = ids.length > 0 && checked.length === ids.length;
  const today = todayBahia(new Date(nowMs));

  const run = (sel: string[], kind: "veio" | "faltou" | "remarcar") => start(async () => {
    const r = kind === "remarcar" ? await toWaitlistManyAction(sel) : await markManyAction(sel, kind === "veio" ? "compareceu" : "faltou");
    if (!r.ok) { toast(r.error, "error"); return; }
    const { done, failed } = r.data!;
    setGone((g) => [...g, ...done]);
    setChk((c) => c.filter((x) => !done.includes(x)));
    const n = done.length;
    const msg = kind === "veio" ? (n === 1 ? "Baixa feita: veio." : `${n} baixas feitas: vieram.`)
      : kind === "faltou" ? (n === 1 ? "Marcado como falta." : `${n} marcados como falta.`)
      : (n === 1 ? "Saiu da agenda e foi para a lista de espera." : `${n} saíram da agenda e foram para a lista de espera.`);
    if (n) {
      const undo = kind !== "remarcar" && canBook ? { label: "Desfazer", onClick: () => start(async () => {
        const u = await undoManyAction(done);
        if (!u.ok) { toast(u.error, "error"); return; }
        setGone((g) => g.filter((x) => !u.data!.done.includes(x)));
        toast(u.data!.failed.length ? `Desfeito em ${u.data!.done.length}; ${u.data!.failed[0].error}` : "Desfeito");
        router.refresh();
      }) } : undefined;
      toast(msg + (kind === "remarcar" && catalog?.agendaMode === "dupla" ? " Cancele também no Avec." : ""), "ok", undo);
    }
    if (failed.length) toast(`${failed.length === 1 ? "Um não foi" : `${failed.length} não foram`}: ${failed[0].error}`, "error");
    router.refresh();
  });

  /** Faltou pede confirmação (QA r58, M-2); o aviso depois tem Desfazer. */
  const confirmNoShow = useConfirmNoShow();
  const noShow = (sel: string[]) => {
    const one = sel.length === 1 ? list.find((x) => x.appointmentId === sel[0]) : null;
    confirmNoShow({ who: one ? shownName(one) : `${sel.length} horários`, detail: one?.service ?? null, onConfirm: () => run(sel, "faltou") });
  };

  if (!list.length) return <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong"><Empty title="Tudo com desfecho">Nada pendente nos últimos {NO_BAIXA_DAYS} dias.</Empty></div>;
  const groups = [...new Set(list.map((i) => dayOf(i.scheduledAt)))].sort().reverse();
  const box = (on: boolean) => cn("grid size-[22px] shrink-0 place-items-center rounded-[6px]", on ? "bg-ink text-paper" : "border-2 border-control bg-paper");
  return (
    <div className="flex flex-col gap-4">
      <p className="text-md font-semibold text-alert tabular">{list.length === 1 ? "1 horário sem desfecho" : `${list.length} horários sem desfecho`} nos últimos {NO_BAIXA_DAYS} dias.</p>
      <p className="-mt-3 text-sm text-graphite">Passou da hora e ninguém marcou Chegou. A maioria veio do Avec. Marque o que aconteceu, um por um ou em lote.</p>
      <div className="sticky -top-4 z-10 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-[var(--radius-card)] bg-paper-2 px-3 py-2">
        <button type="button" role="checkbox" aria-checked={all} onClick={() => setChk(all ? [] : ids)} className="inline-flex min-h-11 items-center gap-2.5 text-base font-medium">
          <span className={box(all)}>{all && <IconCheck size={14} aria-hidden />}</span>{checked.length ? `${checked.length} de ${ids.length} marcados` : `Marcar todos (${ids.length})`}
        </button>
        {checked.length > 0 && (
          <span className="ml-auto flex flex-wrap gap-2">
            <Button disabled={pending} onClick={() => run(checked, "veio")}>Veio</Button>
            <Button variant="secondary" disabled={pending} onClick={() => noShow(checked)}>Faltou</Button>
            {canBook && <Button variant="secondary" disabled={pending} title="Sai da agenda e vai para a lista de espera" onClick={() => run(checked, "remarcar")}>Tirar da agenda</Button>}
          </span>
        )}
      </div>
      {groups.map((d) => (
        <section key={d} aria-labelledby={`sb-${d}`}>
          <h3 id={`sb-${d}`} className="mb-1 text-base font-semibold text-ink-2">{dayTitle(d, today)} · <span className="tabular">{list.filter((i) => dayOf(i.scheduledAt) === d).length}</span></h3>
          <ul>
            {list.filter((i) => dayOf(i.scheduledAt) === d).map((i) => {
              const id = i.appointmentId!;
              const on = checked.includes(id);
              const late = Math.round((nowMs - new Date(i.scheduledAt).getTime()) / 60_000);
              return (
                <li key={i.key} className="flex flex-wrap items-center gap-3 border-b border-line/80 py-3">
                  <button type="button" role="checkbox" aria-checked={on} aria-label={`Selecionar ${shownName(i)}`} onClick={() => setChk((c) => (on ? c.filter((x) => x !== id) : [...c, id]))} className="grid size-11 place-items-center">
                    <span className={box(on)}>{on && <IconCheck size={14} aria-hidden />}</span>
                  </button>
                  <span className="w-28 shrink-0 text-md font-semibold tabular">{timeRange(i.scheduledAt, i.durationMin).replace(" – ", "–")}</span>
                  <span className="flex min-w-0 flex-[1_1_220px] flex-col">
                    <span className="text-md font-semibold">{shownName(i)}</span>
                    <span className="text-sm text-graphite">{[i.service, i.professionalName && `com ${first(i.professionalName)}`].filter(Boolean).join(" ")}</span>
                  </span>
                  <span className="inline-flex h-[26px] items-center rounded-full bg-alert-soft px-2.5 text-xs font-semibold text-alert tabular">{d === today ? `Passou ${durationLabel(Math.max(late, 1))}` : "Sem desfecho"}</span>
                  <span className="rounded-full bg-paper-2 px-2 text-xs font-medium text-ink-2">{originLabel(i)}</span>
                  {i.avecSemBaixa && <span title="O relatório Agendamentos por status do Avec traz esta reserva como Agendado" className="rounded-full bg-gold-soft px-2 text-xs font-medium text-gold-ink">Avec: sem desfecho também</span>}
                  <span className="flex flex-wrap gap-2">
                    <Button disabled={pending} aria-label={`Veio: ${shownName(i)}`} onClick={() => run([id], "veio")}>Veio</Button>
                    <Button variant="secondary" disabled={pending} aria-label={`Faltou: ${shownName(i)}`} onClick={() => noShow([id])}>Faltou</Button>
                    {canBook && <Button variant="secondary" disabled={pending} aria-label={`Tirar da agenda: ${shownName(i)}`} title="Sai da agenda e vai para a lista de espera" onClick={() => run([id], "remarcar")}>Tirar da agenda</Button>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Falta pagar (caixa no CRM): finalizado e sem comanda fechada. */
function PayList({ items }: { items: AgendaItem[] }) {
  const comanda = useComanda();
  return (
    <ul>
      {items.map((i) => (
        <li key={i.key} className="flex flex-wrap items-center gap-3 border-b border-line/80 py-3">
          <span className="w-16 shrink-0 text-md font-semibold tabular">{hm(minuteOfDay(i.scheduledAt))}</span>
          <span className="flex min-w-0 flex-[1_1_220px] flex-col">
            <span className="text-md font-semibold">{shownName(i)}</span>
            <span className="text-sm text-graphite">{[i.service, i.professionalName && `com ${first(i.professionalName)}`].filter(Boolean).join(" ")}</span>
          </span>
          {comanda && i.appointmentId && <Button variant="secondary" onClick={() => (i.openComandaId ? comanda.openById(i.openComandaId) : comanda.openForAppointment(i.appointmentId!))}>{i.openComandaId ? "Ver comanda" : "Abrir comanda"}</Button>}
        </li>
      ))}
    </ul>
  );
}
