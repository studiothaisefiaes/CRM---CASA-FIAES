"use client";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { TodayItem } from "@/server/queries/today";
import { useUrgency } from "@/components/pipeline/timer";
import { formatPhoneClient } from "@/lib/phone-client";
import { IconClock, IconArrowRight } from "@/components/icons";
import { Empty } from "@/components/ui/empty";
import { SPRING } from "@/lib/motion";

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

function Row({ i }: { i: TodayItem }) {
  const { urgency, label } = useUrgency(i.at, i.slaMinutes);
  return (
    <Link href={`/funil?lead=${i.id}`} className={`group flex items-center gap-3 px-3 py-2.5 rounded-[12px] transition-colors ${urgency === "late" ? "bg-alert-soft hover:bg-alert-soft/80" : "hover:bg-paper-2"}`}>
      <span className={`size-2 rounded-full shrink-0 ${urgency === "late" ? "bg-alert animate-pulse" : urgency === "warn" ? "bg-gold" : "bg-line-strong"}`} />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium truncate">{i.name ?? formatPhoneClient(i.phone)}</span>
        <span className="block text-[12px] text-muted">{i.stageName}</span>
      </span>
      <span className={`inline-flex items-center gap-1 text-[13px] font-semibold tabular ${urgency === "late" ? "text-alert" : urgency === "warn" ? "text-gold-ink" : "text-graphite"}`} suppressHydrationWarning><IconClock size={14} />{label}</span>
      <IconArrowRight size={15} className="text-muted opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    </Link>
  );
}
