"use client";
import Link from "next/link";
import { memo, type MouseEvent, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { QueueItem } from "@/server/queries/queue";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconCheck, IconMic } from "@/components/icons";
import { useClock, useHours } from "@/components/pipeline/timer";
import { useCrossedThreshold } from "@/components/motion/use-crossed-threshold";
import { EASE } from "@/lib/motion";
import { businessSecondsBetween, type BusinessHours } from "@/lib/business-hours";
import { seconds } from "@/lib/format";
import { formatPhoneClient } from "@/lib/phone-client";
import { ringState, slaProgress, slaStatus, type QueueSectionKey, type RingState } from "@/lib/queue";
import { cn } from "@/lib/cn";

const KIND: Record<string, string> = { audio: "Áudio", image: "Foto", sticker: "Figurinha", video: "Vídeo", document: "Documento", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem" };
const RING_COLOR: Record<Exclude<RingState, "none">, string> = { ok: "var(--color-graphite)", near: "var(--color-gold)", late: "var(--color-alert)" };

/** Só em teste: quantas vezes o corpo de um item da Fila rodou (prova que o relógio não re-renderiza as linhas). */
export const __itemRenderCount = { value: 0 };
function countRender() { if (process.env.NODE_ENV === "test") __itemRenderCount.value++; }

/** Anel de SLA em volta do avatar: quanto do prazo da etapa já passou. A cor nunca vem sozinha; o texto ao lado diz o estado. */
function Ring({ state, progress, size, pulse, children }: { state: RingState; progress: number; size: number; pulse: boolean; children: ReactNode }) {
  const reduced = useReducedMotion();
  if (state === "none") return <span className="shrink-0 grid place-items-center" style={{ width: size + 8, height: size + 8 }}>{children}</span>;
  const stroke = state === "late" ? 3.5 : 3, r = (size + 8) / 2 - stroke / 2, c = 2 * Math.PI * r;
  return (
    <span className="relative shrink-0 grid place-items-center" style={{ width: size + 8, height: size + 8 }}>
      <svg aria-hidden className="absolute inset-0 -rotate-90" width={size + 8} height={size + 8} viewBox={`0 0 ${size + 8} ${size + 8}`}>
        <circle cx={(size + 8) / 2} cy={(size + 8) / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle cx={(size + 8) / 2} cy={(size + 8) / 2} r={r} fill="none" stroke={RING_COLOR[state]} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - progress)} />
      </svg>
      {/* Pulso único ao atrasar (2 ciclos, ~1,2 s, só transform e opacity); depois fica parado. Sem pulso infinito (WCAG 2.2.2). */}
      {pulse && <motion.span aria-hidden data-testid="pulso-atraso" className="pointer-events-none absolute inset-0 rounded-full border-2 border-alert" initial={{ opacity: 0.7, scale: 1 }} animate={{ opacity: 0, scale: reduced ? 1 : 1.35 }} transition={{ duration: 0.6, ease: EASE, repeat: 1 }} />}
      {children}
    </span>
  );
}

/** Quanto o lead espera, em segundos úteis, e em que estado o anel está. A única conta que depende do relógio. */
function waitOf(section: QueueSectionKey, since: number | null, slaMinutes: number | null, now: number, hours: BusinessHours) {
  const waitSec = since != null ? businessSecondsBetween(since, now, hours) : 0;
  const ring = ringState({ awaiting: since != null, late: section === "atrasados", waitSeconds: waitSec, slaMinutes });
  return { waitSec, ring, progress: ring === "late" ? 1 : slaProgress(waitSec, slaMinutes) };
}

/**
 * Folha do anel: escuta o relógio sozinha e só re-renderiza quando o anel muda de fato (a cada 1% do prazo), nunca a linha inteira.
 * `children` (o avatar) vem pronto do pai, então o React nem o toca.
 */
function RowRing({ section, since, slaMinutes, size, children }: { section: QueueSectionKey; since: number | null; slaMinutes: number | null; size: number; children: ReactNode }) {
  const hours = useHours();
  const key = useClock((now) => { const w = waitOf(section, since, slaMinutes, now, hours); return `${w.ring}:${Math.round(w.progress * 100)}`; }, since ?? 0);
  const [state, pct] = key.split(":") as [RingState, string];
  const pulse = useCrossedThreshold(state === "late" ? 1 : 0, 1);
  return <Ring state={state} progress={Number(pct) / 100} size={size} pulse={pulse}>{children}</Ring>;
}

/** Folha do tempo de espera ("3 min 20 s"): só o texto muda, a linha não re-renderiza. */
function RowTime({ section, since, slaMinutes, className }: { section: QueueSectionKey; since: number; slaMinutes: number | null; className: string }) {
  const hours = useHours();
  const text = useClock((now) => seconds(waitOf(section, since, slaMinutes, now, hours).waitSec), since);
  return <span className={cn("shrink-0 tabular", className)}>{text}</span>;
}

const WEIGHT: Record<QueueSectionKey, { row: string; avatar: number; name: string; time: string }> = {
  atrasados: { row: "bg-alert-soft border-l-[5px] border-l-alert py-3.5", avatar: 44, name: "text-base font-semibold", time: "text-[18px] font-semibold text-alert" },
  perto: { row: "border-l-[4px] border-l-gold py-3", avatar: 40, name: "text-base font-semibold", time: "text-base font-semibold text-gold-ink" },
  aguardando: { row: "border-l-[3px] border-l-transparent py-3", avatar: 40, name: "text-base font-medium", time: "text-base font-medium text-ink" },
  "acoes-hoje": { row: "border-l-[3px] border-l-transparent py-2.5", avatar: 36, name: "text-base font-medium", time: "text-sm text-graphite" },
  parados: { row: "border-l-[3px] border-l-transparent py-2.5", avatar: 36, name: "text-base font-medium text-graphite", time: "text-sm text-graphite" },
  "aguardando-cliente": { row: "border-l-[3px] border-l-transparent py-2", avatar: 32, name: "text-sm font-medium text-graphite", time: "text-sm text-graphite" },
  reengajar: { row: "border-l-[3px] border-l-transparent py-2.5", avatar: 36, name: "text-base font-medium", time: "text-sm text-graphite" },
};

function statusOf(section: QueueSectionKey, item: QueueItem, since: number | null, now: number, hours: BusinessHours): { text: string; tone: string } | null {
  const { ring, waitSec } = waitOf(section, since, item.slaMinutes, now, hours);
  const sla = slaStatus({ ring, alert: section === "atrasados", waitSeconds: waitSec, slaMinutes: item.slaMinutes });
  if (sla) return { text: sla.text, tone: sla.tone === "late" ? "text-alert font-semibold" : sla.tone === "near" ? "text-gold-ink font-semibold" : "text-graphite" };
  if (section === "acoes-hoje" && item.nextAction) {
    const due = new Date(item.nextAction.dueAt);
    const hora = due.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
    return { text: `${item.nextAction.title} · ${due.getTime() < now ? "venceu" : "hoje"} ${hora}`, tone: "text-gold-ink font-medium" };
  }
  if (section === "reengajar") {
    const days = item.lastAt ? Math.max(0, Math.floor((now - new Date(item.lastAt).getTime()) / 86_400_000)) : null;
    return { text: days == null ? "sem mensagens ainda" : `sem contato há ${days} d`, tone: "text-graphite" };
  }
  if (section === "parados") return { text: "parado, sem próxima ação", tone: "text-graphite" };
  if (section === "aguardando-cliente") return { text: item.nextAction ? `próxima ação: ${item.nextAction.title}` : "esperando a cliente", tone: "text-muted" };
  return null;
}

/** Folha da linha de prazo ("atrasado 4 min", "dentro do prazo"): re-renderiza só quando o texto muda. */
function RowStatus({ section, item, since }: { section: QueueSectionKey; item: QueueItem; since: number | null }) {
  const hours = useHours();
  // Primeira pintura (servidor e hidratação): espera zero e relógio zerado, como antes; o relógio real entra logo depois.
  const key = useClock((now) => { const s = statusOf(section, item, since, now, hours); return s ? `${s.tone}|${s.text}` : ""; }, since ?? 0);
  if (!key) return null;
  const i = key.indexOf("|");
  return <span className={cn("mt-1 block text-[13px] tabular", key.slice(0, i))}>{key.slice(i + 1)}</span>;
}

/**
 * Seleção em massa de um item, em valores simples (e um callback estável) para o `memo` da linha valer: um objeto novo a cada render
 * da lista faria todas as linhas re-renderizarem. `selecting` ligado: tocar marca em vez de abrir.
 */
export type RowSelection = { selectable: boolean; selecting: boolean; checked: boolean; onSelect: (dealId: string, range: boolean) => void };

/** A caixinha de marcar. Só desenho (aria-hidden): quem marca é a própria linha (`option` com `aria-selected`), por Espaço ou toque. */
function Box({ checked, size = 22 }: { checked: boolean; size?: number }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-[6px] border-2 transition-colors", checked ? "border-ink bg-ink text-paper" : "border-graphite bg-paper")} style={{ width: size, height: size }}>
      {checked && <IconCheck size={size - 8} strokeWidth={3} />}
    </span>
  );
}

export const QueueRow = memo(function QueueRow({ item, section, selected, href, tabIndex, onOpen, selectable = false, selecting = false, checked = false, onSelect }: {
  item: QueueItem; section: QueueSectionKey; selected: boolean; href: string; tabIndex: number; onOpen?: (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => void;
} & Partial<RowSelection>) {
  countRender();
  const w = WEIGHT[section];
  const since = item.awaitingSince ? new Date(item.awaitingSince).getTime() : null;
  const name = item.name === item.phone ? formatPhoneClient(item.phone) : item.name;
  const snippet = item.lastMessage || (item.lastKind ? KIND[item.lastKind] ?? null : null);
  const pills = item.signals.filter((s) => s !== "Sem dono");
  return (
    <Link href={href} prefetch={false} scroll={false} role="option" aria-selected={selecting ? checked : selected} tabIndex={tabIndex} data-deal-id={item.dealId}
      onClick={(e) => {
        if (selecting) { e.preventDefault(); onSelect?.(item.dealId, e.shiftKey); return; }
        onOpen?.(item, e);
      }}
      className={cn(
        "group relative flex items-start gap-3 pl-3 pr-4 min-h-[72px] border-b border-line/80 outline-offset-[-2px] scroll-mt-12 scroll-mb-2 transition-colors aria-selected:ring-2 aria-selected:ring-inset aria-selected:ring-gold",
        w.row, (selecting ? checked : selected) ? "bg-gold-soft/70 hover:bg-gold-soft" : section === "atrasados" ? "hover:bg-alert-soft/70" : "hover:bg-paper-2",
      )}>
      {selecting && <span aria-hidden data-testid="item-caixa" className="-ml-1.5 -mr-1 grid size-11 shrink-0 place-items-center self-center"><Box checked={checked} /></span>}
      <span className="relative shrink-0">
        <RowRing section={section} since={since} slaMinutes={item.slaMinutes} size={w.avatar}>
          <ContactAvatar contactId={item.contactId} hasAvatar={item.hasAvatar} name={name} size={w.avatar} />
        </RowRing>
        {/* Desktop: a caixinha aparece sobre a foto ao passar o mouse ou focar o item. No celular a seleção entra por "Selecionar". */}
        {selectable && !selecting && (
          <span aria-hidden data-testid="item-selecionar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect?.(item.dealId, e.shiftKey); }}
            className="absolute inset-0 hidden place-items-center rounded-full bg-paper/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 pointer-fine:grid"><Box checked={false} /></span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate", w.name)}>{name}</span>
          {since != null && <RowTime section={section} since={since} slaMinutes={item.slaMinutes} className={w.time} />}
        </span>
        {snippet && (
          <span className={cn("mt-0.5 block truncate text-sm", item.lastDirection === "in" ? "text-ink-2" : "text-graphite")}>
            {item.lastKind === "audio" && <IconMic size={13} className="inline -mt-0.5 mr-1" />}
            {item.lastDirection === "out" && <span className="text-muted">Você: </span>}{snippet}
          </span>
        )}
        <RowStatus section={section} item={item} since={since} />
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{item.stageName}</span><span aria-hidden>·</span><span className="truncate max-w-[16ch]">{item.sourceLabel}</span><span aria-hidden>·</span>
          <span className={item.ownerName ? "" : "text-gold-ink font-medium"}>{item.ownerName ? item.ownerName.split(/\s+/)[0] : "Sem dono"}</span>
          {pills.map((s) => (
            <span key={s} className={cn("rounded-full px-1.5 py-px font-medium", s === "Tarefa atrasada" ? "bg-alert-soft text-alert" : s === "Cliente" ? "bg-ok-soft text-ok" : "bg-paper-2 text-graphite")}>{s}</span>
          ))}
        </span>
      </span>
    </Link>
  );
});
