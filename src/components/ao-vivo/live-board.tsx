"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DayVisitSheet } from "@/components/agenda/day-visit";
import { ProAvatar } from "@/components/agenda/pro-avatar";
import { IconExpand, IconShrink } from "@/components/icons";
import { buildLiveBoard, minText, type LiveColumn, type LiveNow, type LiveSlot } from "@/lib/ao-vivo";
import { cn } from "@/lib/cn";
import type { LiveBoardData } from "@/server/queries/ao-vivo";

const HORA = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Bahia" });
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Bahia" });
const hora = (iso: string | number) => HORA.format(new Date(iso));
const TICK_MS = 15_000;

/**
 * Ao vivo (spec 17/10, pedido do dono: "uma tela ao vivo… para ter o controle total do que está acontecendo aqui na Casa"): o monitor da
 * recepção. Fonte grande para ler de longe; o relógio anda sozinho a cada 15 s e a página recarrega com o tempo real (LiveRefresh).
 * Tocar na cliente abre a visita do dia (a mesma do Hoje e da Agenda, com a comanda quando o caixa está no CRM).
 * `frozen`: hora fixa (`?agora=`, prints e e2e).
 */
export function LiveBoard({ data, nowMs, frozen, caixaOn }: { data: LiveBoardData; nowMs: number; frozen: boolean; caixaOn: boolean }) {
  // O relógio: a hora do servidor (a cada recarga) ou a do navegador, a mais nova; parado com `frozen`.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (frozen) return;
    const id = setInterval(() => setTick(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [frozen]);
  const clock = frozen ? nowMs : Math.max(nowMs, tick);
  const board = useMemo(() => buildLiveBoard({ visits: data.visits, pros: data.pros, startedAt: data.startedAt, nowMs: clock, caixaOn }), [data, clock, caixaOn]);
  const [opened, setOpened] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const full = useFullscreen(root);
  const open = (s: LiveSlot) => setOpened(s.appointmentId);

  return (
    <section ref={root} aria-label="Ao vivo" className={cn("flex min-h-full flex-col bg-paper text-[17px]", full.on ? "overflow-auto p-6 lg:p-8" : "px-5 pb-12 pt-5 lg:px-8")}>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="sr-only">Ao vivo</h2>
        <p className="text-base text-graphite first-letter:uppercase">{DIA.format(new Date(clock))}, atualiza sozinha</p>
        <div className="flex items-center gap-4">
          <p className="font-display text-[44px] font-light leading-none tabular" aria-label={`Agora são ${hora(clock)}`}>{hora(clock)}</p>
          {full.supported && (
            <button type="button" onClick={full.toggle}
              className="inline-flex h-11 items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-paper px-4 text-base font-medium hover:bg-paper-2">
              {full.on ? <IconShrink size={18} /> : <IconExpand size={18} />}{full.on ? "Sair da tela cheia" : "Tela cheia"}
            </button>
          )}
        </div>
      </header>

      <Top top={board.top} />

      {board.columns.length ? (
        <div className="-mx-1 mt-5 grid snap-x auto-cols-[minmax(min(85vw,270px),1fr)] grid-flow-col gap-3 overflow-x-auto px-1 pb-2">
          {board.columns.map((c) => <Column key={c.id ?? "sem"} c={c} onOpen={open} />)}
        </div>
      ) : <p className="mt-10 text-xl text-graphite">Nenhuma profissional com horário hoje.</p>}

      {opened && <DayVisitSheet appointmentId={opened} open onClose={() => setOpened(null)} nowMs={clock} />}
    </section>
  );
}

const onFullscreen = (cb: () => void) => { document.addEventListener("fullscreenchange", cb); return () => document.removeEventListener("fullscreenchange", cb); };
const noop = () => () => {};

/** Tela cheia no próprio Ao vivo (o menu some). Sem a Fullscreen API (Safari do iPhone), o botão não aparece. */
function useFullscreen(ref: React.RefObject<HTMLElement | null>) {
  const supported = useSyncExternalStore(noop, () => !!document.fullscreenEnabled, () => true);
  const on = useSyncExternalStore(onFullscreen, () => !!document.fullscreenElement && document.fullscreenElement === ref.current, () => false);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void ref.current?.requestFullscreen?.().catch(() => {});
  };
  return { supported, on, toggle };
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** O topo: quem passou da hora sem Chegou (discreto: a chegada ainda é marcada no Avec), quem chegou e não começou e quem falta pagar. */
function Top({ top }: { top: ReturnType<typeof buildLiveBoard>["top"] }) {
  const names = (xs: string[]) => (xs.length ? <span className="text-graphite">: {xs.join(", ")}</span> : null);
  return (
    <section aria-label="Agora na Casa" className="mt-5 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-y border-line py-3">
      <p data-testid="topo-esperando" className="text-lg">
        <b className="font-display text-[30px] font-normal tabular">{top.waiting.length}</b> esperando começar{names(top.waiting)}
      </p>
      {top.toPay && (
        <p data-testid="topo-receber" className="text-lg">
          <b className="font-display text-[30px] font-normal tabular">{top.toPay.length}</b> a receber{names(top.toPay)}
        </p>
      )}
      <p data-testid="topo-atrasadas" className="text-base text-graphite">
        {top.late.length} {plural(top.late.length, "atrasada", "atrasadas")} para chegar{top.late.length ? `: ${top.late.join(", ")}` : ""}
      </p>
    </section>
  );
}

function Column({ c, onOpen }: { c: LiveColumn; onOpen: (s: LiveSlot) => void }) {
  return (
    <section aria-label={c.name} className="flex min-w-0 snap-start flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-paper-2/60 p-4">
      <header className="flex items-center gap-3">
        <ProAvatar name={c.name} color={c.color} photoUrl={c.photoUrl} size={52} />
        <div className="min-w-0">
          <h2 className="truncate text-[22px] font-semibold leading-tight">{c.name}</h2>
          {c.assistants.length > 0 && (
            <p className="mt-0.5 flex items-center gap-1.5 text-base text-graphite">
              {c.assistants.map((a) => <ProAvatar key={a.id} name={a.name} color={null} photoUrl={a.photoUrl} size={22} />)}
              <span>com {c.assistants.map((a) => a.name).join(" e ")}</span>
            </p>
          )}
        </div>
      </header>

      <div data-testid="agora" className="flex flex-col gap-3">
        {c.now.length ? c.now.map((s) => <Now key={s.appointmentId} s={s} onOpen={onOpen} />)
          : <p className="rounded-[var(--radius-control)] border border-dashed border-line-strong px-4 py-5 text-xl text-graphite">Livre agora</p>}
      </div>

      <div data-testid="proxima" className="border-t border-line pt-3">
        <p className="text-sm text-graphite">Próxima</p>
        {c.next ? (
          <button type="button" onClick={() => onOpen(c.next!)} aria-label={`Abrir a visita de ${c.next.client}`} className="mt-1 block w-full rounded-[var(--radius-control)] text-left hover:bg-paper-3/60">
            <span className="flex items-baseline gap-3">
              <span className="text-[22px] font-semibold tabular">{hora(c.next.start)}</span>
              <span className="min-w-0 break-words text-[20px] font-medium leading-snug">{c.next.client}</span>
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-2 text-base text-graphite">
              <span>{c.next.service}{c.next.doer ? `, com ${c.next.doer}` : ""}</span>
              {c.next.inHouse && <span className="rounded-full bg-ok-soft px-2.5 py-0.5 text-sm font-medium text-ok">já está na Casa</span>}
              {c.next.lateMin != null && <span className="text-sm text-muted">passou {minText(c.next.lateMin)}, sem Chegou</span>}
            </span>
          </button>
        ) : <p className="mt-1 text-lg text-graphite">Ninguém mais hoje</p>}
      </div>

      <p className="mt-auto flex justify-between gap-2 text-base text-graphite">
        <span>{c.later ? `Depois: ${c.later} ${plural(c.later, "cliente", "clientes")}` : "Depois: ninguém"}</span>
        {c.done > 0 && <span className="tabular">{c.done} {plural(c.done, "finalizada", "finalizadas")}</span>}
      </p>
    </section>
  );
}

function Now({ s, onOpen }: { s: LiveNow; onOpen: (s: LiveSlot) => void }) {
  const over = s.overMin > 0;
  return (
    <button type="button" onClick={() => onOpen(s)} aria-label={`Abrir a visita de ${s.client}`}
      className="block w-full rounded-[var(--radius-control)] border border-line bg-paper p-4 text-left shadow-[0_1px_0_var(--color-line)] transition-colors hover:border-graphite">
      <span className="block break-words text-[26px] font-semibold leading-tight">{s.client}</span>
      <span className="mt-1 block text-lg text-ink-2">{s.service}{s.doer ? `, com ${s.doer}` : ""}</span>
      <span className="mt-3 flex flex-wrap items-baseline justify-between gap-x-3 text-lg tabular">
        <span className="whitespace-nowrap">há {minText(s.elapsedMin)}</span>
        {s.remainingMin != null && (over
          ? <span className="whitespace-nowrap font-medium text-gold-ink">passou {minText(s.overMin)} do previsto</span>
          : <span className="whitespace-nowrap font-medium">faltam {minText(s.remainingMin)}</span>)}
      </span>
      {s.progress != null && (
        <span role="progressbar" aria-label={`Tempo do serviço de ${s.client}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)}
          className="mt-2 block h-2.5 overflow-hidden rounded-full bg-paper-3">
          <span className={cn("block h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none", over ? "bg-gold-ink" : "bg-gold")} style={{ width: `${Math.round(s.progress * 100)}%` }} />
        </span>
      )}
    </button>
  );
}
