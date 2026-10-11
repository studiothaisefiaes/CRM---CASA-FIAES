"use client";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { TodayItem } from "@/server/queries/today";
import { useClock, useHours } from "@/components/pipeline/timer";
import { useCrossedThreshold } from "@/components/motion/use-crossed-threshold";
import { businessSecondsBetween } from "@/lib/business-hours";
import { ringState, slaStatus } from "@/lib/queue";
import { formatPhoneClient } from "@/lib/phone-client";
import { IconClock, IconArrowRight } from "@/components/icons";
import { Empty } from "@/components/ui/empty";
import { EASE, SPRING_UI } from "@/lib/motion";
import { leadHref } from "@/lib/lead-href";

export function WaitingList({ items }: { items: TodayItem[] }) {
  if (!items.length) return <Empty title="Ninguém esperando">Todas as conversas foram respondidas. Novos leads aparecem aqui na hora.</Empty>;
  return (
    <ul className="px-2 pb-2">
      <AnimatePresence initial={false}>
        {items.map((item, idx) => <motion.li key={item.id} layout layoutDependency={idx} transition={SPRING_UI} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}><Row i={item} /></motion.li>)}
      </AnimatePresence>
    </ul>
  );
}

/**
 * Uma regra só, a da Fila: vermelho é o alerta de espera aberto (`late`, o mesmo do contador). Passou do prazo sem alerta ainda: dourado, "prazo estourado há N".
 * O texto vem de `slaStatus`, o mesmo da linha da Fila.
 */
function Row({ i }: { i: TodayItem }) {
  const hours = useHours();
  const at = i.at ? new Date(i.at).getTime() : null;
  const wait = (now: number) => (at != null ? businessSecondsBetween(at, now, hours) : 0);
  // O relógio entra como valor derivado: a linha só re-renderiza quando o anel muda de estado; o texto do prazo é uma folha.
  const level = useClock((now) => ringState({ awaiting: true, late: !!i.late, waitSeconds: wait(now), slaMinutes: i.slaMinutes }));
  const red = !!i.late, gold = !red && (level === "late" || level === "near");
  const pulse = useCrossedThreshold(red ? 1 : 0, 1);
  const reduced = useReducedMotion();
  return (
    <Link href={leadHref(i.id)} data-late={red ? "sim" : "nao"} className={`group flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-[var(--radius-control)] transition-colors ${red ? "bg-alert-soft hover:bg-alert-soft/80" : "hover:bg-paper-2"}`}>
      <span className={`relative size-2 rounded-full shrink-0 ${red ? "bg-alert" : gold ? "bg-gold" : "bg-line-strong"}`}>
        {/* Pulso único ao atrasar (2 ciclos, ~1,2 s); depois fica parado. Nada de pulso infinito (WCAG 2.2.2). */}
        {pulse && <motion.span aria-hidden data-testid="pulso-atraso" className="absolute inset-0 rounded-full bg-alert" initial={{ opacity: 0.6, scale: 1 }} animate={{ opacity: 0, scale: reduced ? 1 : 3 }} transition={{ duration: 0.6, ease: EASE, repeat: 1 }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium truncate">{i.name ?? formatPhoneClient(i.phone)}</span>
        <span className="block text-xs text-muted">{i.stageName}</span>
      </span>
      <span className={`inline-flex items-center gap-1 text-sm font-semibold tabular text-right ${red ? "text-alert" : gold ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={14} className="shrink-0" /><StatusText i={i} /></span>
      <IconArrowRight size={15} className="text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    </Link>
  );
}

/** O texto do prazo ("atrasado 4 min"): folha, re-renderiza só quando o texto muda. */
function StatusText({ i }: { i: TodayItem }) {
  const hours = useHours();
  const at = i.at ? new Date(i.at).getTime() : null;
  const text = useClock((now) => {
    const waitSeconds = at != null ? businessSecondsBetween(at, now, hours) : 0;
    const ring = ringState({ awaiting: true, late: !!i.late, waitSeconds, slaMinutes: i.slaMinutes });
    return slaStatus({ ring, alert: !!i.late, waitSeconds, slaMinutes: i.slaMinutes })?.text ?? "dentro do prazo";
  });
  return <>{text}</>;
}
