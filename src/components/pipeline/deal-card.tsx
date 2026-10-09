"use client";
import Link from "next/link";
import { motion } from "motion/react";
import type { BoardCard } from "@/server/queries/board";
import { useUrgency } from "./timer";
import { IconMic, IconClock, IconCalendar } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";
import { initials, money } from "@/lib/format";
import { cn } from "@/lib/cn";

export function DealCard({ card, slaMinutes, stageKind, dragging, filtersQs }: {
  card: BoardCard; slaMinutes: number | null; stageKind: string; dragging?: boolean; filtersQs: string;
}) {
  const { urgency, label } = useUrgency(card.awaitingReplySince, slaMinutes);
  const name = card.contactName?.trim() || formatPhoneClient(card.phone);
  const snippet = card.lastMessageKind === "audio" ? "Áudio" : card.lastMessage;
  return (
    <Link href={`/funil?${filtersQs}${filtersQs ? "&" : ""}lead=${card.id}`} scroll={false} draggable={false}
      className={cn(
        "group relative block rounded-[12px] border bg-paper px-3.5 py-3 text-left transition-[border-color,box-shadow,background] duration-200",
        urgency === "late" ? "border-alert/70 bg-alert-soft" : urgency === "warn" ? "border-gold/60" : "border-line hover:border-line-strong",
        dragging ? "shadow-[var(--shadow-pop)] rotate-[1.5deg]" : "shadow-[var(--shadow-card)] hover:shadow-[0_6px_18px_-10px_rgb(40_30_15/0.25)]",
      )}>
      {urgency === "late" && <span className="pointer-events-none absolute -inset-px rounded-[12px] border-2 border-alert animate-[ping_1.6s_cubic-bezier(0,0,0.2,1)_infinite] opacity-40" aria-hidden />}
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-[14px] leading-tight truncate">{name}</p>
        {card.ownerName && <span title={card.ownerName} className="size-6 shrink-0 rounded-full bg-paper-3 text-graphite text-[10px] font-semibold grid place-items-center">{initials(card.ownerName)}</span>}
      </div>
      <p className="text-[12px] text-muted mt-0.5 truncate">{card.origin}{card.isClient ? " · já é cliente" : ""}</p>
      {snippet && (
        <p className={cn("text-[12.5px] mt-2 line-clamp-2 leading-snug", card.lastDirection === "in" ? "text-ink-2" : "text-graphite")}>
          {card.lastMessageKind === "audio" && <IconMic size={13} className="inline -mt-0.5 mr-1" />}
          {card.lastDirection === "out" && <span className="text-muted">Você: </span>}{snippet}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-2.5 min-h-[20px]">
        <div className="flex gap-1.5">
          {card.isClient && <span className="h-5 px-1.5 rounded-[5px] bg-ok-soft text-ok text-[10.5px] font-semibold grid place-items-center">Cliente</span>}
          {stageKind === "agendado" && card.scheduledAt && (
            <span className="h-5 px-1.5 rounded-[5px] bg-gold-soft text-gold-ink text-[10.5px] font-semibold inline-flex items-center gap-1">
              <IconCalendar size={11} />{new Date(card.scheduledAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
          {stageKind === "fechado" && card.valueCents != null && <span className="h-5 px-1.5 rounded-[5px] bg-ok-soft text-ok text-[10.5px] font-semibold grid place-items-center">{money(card.valueCents)}</span>}
        </div>
        {label && (
          <motion.span key={urgency} initial={{ scale: 0.85 }} animate={{ scale: 1 }}
            className={cn("inline-flex items-center gap-1 text-[12px] font-semibold tabular",
              urgency === "late" ? "text-alert" : urgency === "warn" ? "text-gold-ink" : "text-graphite")}
            aria-label={`Esperando resposta há ${label}`} suppressHydrationWarning>
            <IconClock size={13} />{label}
          </motion.span>
        )}
      </div>
    </Link>
  );
}
