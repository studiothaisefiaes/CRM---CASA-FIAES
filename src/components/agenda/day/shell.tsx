"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { IconArrowRight, IconClose, IconMore, IconPlus, IconSearch, IconSettings } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { Button } from "@/components/ui/button";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import { minuteOfDay } from "@/lib/agenda";
import { hhmm } from "@/lib/free-slots";
import type { AgendaMode } from "@/lib/agenda-settings";
import { canBookIn, useAgendaSheets } from "../agenda-sheets";
import { AgendaSearch } from "../agenda-search";
import { BlockSheet } from "../block-sheet";
import { SlotFinder } from "../slot-finder";
import { TransferDaySheet } from "../transfer-day-sheet";
import { PendingPanel, type PendingData, type PendingTab } from "./pending";

type ShellCtx = { q: string; persoOpen: boolean; setPersoOpen: (v: boolean) => void };
const Ctx = createContext<ShellCtx>({ q: "", persoOpen: false, setPersoOpen: () => {} });
/** A busca do topo (apaga os cartões que não batem) e o Personalizar aberto: o topo é do shell, a grade lê daqui. */
export const useAgendaShell = () => useContext(Ctx);

export type ShellNav = {
  /** "Quinta, 16 de outubro" (e a versão curta do celular). */ title: string; shortTitle: string;
  prevHref: string; nextHref: string; prevLabel: string; nextLabel: string; todayHref: string | null;
  view: "dia" | "semana"; dayHref: string; weekHref: string; listHref: string;
};
/** Passar o dia (item 23b): só com `agenda.passar_dia` e a função ligada; o dia (nunca no passado) e as profissionais ativas. */
export type ShellTransfer = { day: string; pros: { id: string; name: string }[] };
export type ShellTools = { /** Dia do Bloquear (nunca no passado). */ day: string; mode: AgendaMode; pros: { id: string; name: string; serviceIds: string[] }[]; services: { id: string; label: string }[] };

/**
 * O alto da Agenda numa linha só (aprovado pelo dono em 16/10): setas, Hoje, a data, Dia/Semana, a busca que abre, o sino das pendências
 * com o contador (abre o painel grande), Personalizar e o único botão dourado, Marcar horário. Procurar horário, Bloquear, Encaixe
 * agora e a lista ficam no "Mais".
 */
export function AgendaShell({ nav, day, nowMs, isToday, tools, transfer = null, pending, initialPending, personalize, children }: {
  nav: ShellNav; day: string; nowMs: number; isToday: boolean; tools: ShellTools | null; transfer?: ShellTransfer | null;
  pending: PendingData; initialPending: PendingTab | null; personalize: boolean; children: ReactNode;
}) {
  const { catalog, book } = useAgendaSheets();
  const router = useRouter();
  const canBook = canBookIn(catalog);
  const [q, setQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [persoOpen, setPersoOpen] = useState(false);
  const [pendTab, setPendTab] = useState<PendingTab | null>(initialPending);
  const [tool, setTool] = useState<"procurar" | "bloquear" | "passar" | null>(null);
  const count = pending.noBaixa.length + pending.waitlistCount + pending.faltaPagar.length + pending.pedidosCount + (pending.confirmByPhone?.items.length ?? 0);
  const more: MenuItem[] = [
    ...(canBook && isToday ? [{ label: "Encaixe agora", detail: "A cliente chegou sem hora marcada", onSelect: () => book({ day, time: hhmm(Math.floor(minuteOfDay(new Date(nowMs)) / 5) * 5), walkIn: true }) }] : []),
    ...(tools ? [{ label: "Procurar horário", onSelect: () => setTool("procurar") }, { label: "Bloquear horário", onSelect: () => setTool("bloquear") }] : []),
    ...(transfer ? [{ label: "Passar o dia de uma profissional", detail: "Quando alguém falta", onSelect: () => setTool("passar") }] : []),
    { label: "Ver o dia em lista", onSelect: () => router.push(nav.listHref) },
  ];
  const seg = "inline-flex h-[34px] pointer-coarse:h-11 items-center rounded-[8px] px-3 text-sm font-medium transition-colors"; // 44 px no toque (QA r58, M-9)
  return (
    <Ctx.Provider value={{ q, persoOpen, setPersoOpen }}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 pt-3 pb-2 lg:flex-nowrap lg:px-6" aria-label="Agenda">
        <div className="flex items-center">
          <Link href={nav.prevHref} aria-label={nav.prevLabel} title={nav.prevLabel} className="grid size-10 place-items-center rounded-[var(--radius-control)] text-ink-2 hover:bg-paper-2">
            <IconArrowRight size={16} className="rotate-180" aria-hidden />
          </Link>
          {nav.todayHref ? <Link href={nav.todayHref} className="inline-flex h-10 pointer-coarse:min-h-11 items-center rounded-[var(--radius-control)] px-3 text-base font-medium hover:bg-paper-2">Hoje</Link>
            : <span className="inline-flex h-10 pointer-coarse:min-h-11 items-center px-3 text-base font-medium text-muted" aria-current="date">Hoje</span>}
          <Link href={nav.nextHref} aria-label={nav.nextLabel} title={nav.nextLabel} className="grid size-10 place-items-center rounded-[var(--radius-control)] text-ink-2 hover:bg-paper-2">
            <IconArrowRight size={16} aria-hidden />
          </Link>
        </div>
        <h1 className="mx-1 truncate font-display text-xl font-normal leading-tight tracking-[-0.01em] tabular" aria-live="polite">
          <span className="sr-only">Agenda, </span><span className="max-sm:hidden">{nav.title}</span><span className="sm:hidden">{nav.shortTitle}</span>
        </h1>
        <nav aria-label="Ver por" className="inline-flex gap-0.5 rounded-[11px] bg-paper-2 p-[3px] max-lg:order-4">
          {(["dia", "semana"] as const).map((v) => (
            <Link key={v} href={v === "dia" ? nav.dayHref : nav.weekHref} aria-current={nav.view === v ? "page" : undefined}
              className={cn(seg, nav.view === v ? "bg-paper font-semibold text-ink shadow-[0_1px_2px_rgb(18_18_18/0.12)]" : "text-ink-2 hover:text-ink")}>{v === "dia" ? "Dia" : "Semana"}</Link>
          ))}
        </nav>
        <span className="flex-1" />
        {searchOpen ? (
          <div className="flex items-center gap-1 max-lg:order-9 max-lg:w-full">
            <AgendaSearch autoFocus onQuery={setQ} />
            <IconButton label="Fechar busca" size="lg" onClick={() => { setSearchOpen(false); setQ(""); }}><IconClose size={16} /></IconButton>
          </div>
        ) : (
          <IconButton label="Buscar cliente" size="lg" onClick={() => setSearchOpen(true)}><IconSearch size={18} /></IconButton>
        )}
        <button type="button" onClick={() => setPendTab(pending.noBaixa.length ? "semBaixa" : "espera")} title="Pendências"
          aria-label={count ? `Pendências: ${pending.noBaixa.length ? `${pending.noBaixa.length} sem desfecho, ` : ""}${count} no total` : "Pendências: nada pendente"}
          className="relative grid size-10 shrink-0 place-items-center rounded-[var(--radius-control)] text-graphite hover:bg-paper-2 hover:text-ink">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5.5 5.5 4 13v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5l-1.5-7.5a1 1 0 0 0-1-.8H6.5a1 1 0 0 0-1 .8Z" /></svg>
          {count > 0 && <span aria-hidden className={cn("absolute right-0.5 top-1 grid h-4 min-w-4 place-items-center rounded-full px-1 text-xs font-bold tabular text-paper", pending.noBaixa.length ? "bg-alert" : "bg-gold-ink")}>{count}</span>}
        </button>
        {personalize && (
          <Button variant="ghost" aria-expanded={persoOpen} onClick={() => setPersoOpen(true)} className="max-lg:order-5 max-lg:ml-auto max-sm:px-2.5">
            <IconSettings size={16} aria-hidden /><span className="max-sm:sr-only">Personalizar</span>
          </Button>
        )}
        <Menu label="Mais ações da agenda" items={more} trigger={<IconMore size={18} />} triggerClassName="size-10" className={cn("max-lg:order-5", !personalize && "max-lg:ml-auto")} />
        {canBook && (
          <Button variant="gold" aria-label="Marcar horário" onClick={() => book({ day, time: "" })} className="max-lg:order-5 max-sm:px-3">
            <IconPlus size={16} aria-hidden /><span className="max-sm:hidden">Marcar horário</span>
          </Button>
        )}
      </header>
      {children}
      <PendingPanel open={!!pendTab} tab={pendTab ?? "semBaixa"} onTab={setPendTab} onClose={() => setPendTab(null)} data={pending} nowMs={nowMs} />
      {tools && (
        <>
          <SlotFinder open={tool === "procurar"} onClose={() => setTool(null)} services={tools.services} pros={tools.pros} />
          <BlockSheet open={tool === "bloquear"} onClose={() => setTool(null)} pros={tools.pros} mode={tools.mode} day={tools.day} />
        </>
      )}
      {transfer && <TransferDaySheet open={tool === "passar"} onClose={() => setTool(null)} day={transfer.day} pros={transfer.pros} />}
    </Ctx.Provider>
  );
}
