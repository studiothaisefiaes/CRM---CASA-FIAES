"use client";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { TodayItem } from "@/server/queries/today";
import { useHours, useNow } from "@/components/pipeline/timer";
import { businessSecondsBetween } from "@/lib/business-hours";
import { ringState, slaStatus } from "@/lib/queue";
import { formatPhoneClient } from "@/lib/phone-client";
import { IconClock, IconArrowRight } from "@/components/icons";
import { Empty } from "@/components/ui/empty";
import { SPRING } from "@/lib/motion";
import { leadHref } from "@/lib/lead-href";

export function WaitingList({ items }: { items: TodayItem[] }) {
  if (!items.length) return <Empty title="Ninguém esperando">Todas as conversas foram respondidas. Novos leads aparecem aqui na hora.</Empty>;
  return (
    <ul className="px-2 pb-2">
      <AnimatePresence initial={false}>
        {items.map((i) => <motion.li key={i.id} layout transition={SPRING} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }}><Row i={i} /></motion.li>)}
      </AnimatePresence>
    </ul>
  );
}

/**
 * Uma regra só, a da Fila: vermelho é o alerta de espera aberto (`late`, o mesmo do contador). Passou do prazo sem alerta ainda: dourado, "prazo estourado há N".
 * O texto vem de `slaStatus`, o mesmo da linha da Fila.
 */
function Row({ i }: { i: TodayItem }) {
  const now = useNow();
  const hours = useHours();
  const waitSeconds = i.at ? businessSecondsBetween(new Date(i.at).getTime(), now, hours) : 0;
  const ring = ringState({ awaiting: true, late: !!i.late, waitSeconds, slaMinutes: i.slaMinutes });
  const status = slaStatus({ ring, alert: !!i.late, waitSeconds, slaMinutes: i.slaMinutes });
  const red = !!i.late, gold = !red && (ring === "late" || ring === "near");
  return (
    <Link href={leadHref(i.id)} data-late={red ? "sim" : "nao"} className={`group flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-[var(--radius-control)] transition-colors ${red ? "bg-alert-soft hover:bg-alert-soft/80" : "hover:bg-paper-2"}`}>
      <span className={`size-2 rounded-full shrink-0 ${red ? "bg-alert animate-pulse" : gold ? "bg-gold" : "bg-line-strong"}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-base font-medium truncate">{i.name ?? formatPhoneClient(i.phone)}</span>
        <span className="block text-xs text-muted">{i.stageName}</span>
      </span>
      <span className={`inline-flex items-center gap-1 text-sm font-semibold tabular text-right ${red ? "text-alert" : gold ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={14} className="shrink-0" />{status?.text ?? "dentro do prazo"}</span>
      <IconArrowRight size={15} className="text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    </Link>
  );
}
