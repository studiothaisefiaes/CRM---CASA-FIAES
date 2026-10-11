"use client";
import Link from "next/link";
import type { BoardCard } from "@/server/queries/board";
import { memo } from "react";
import { useUrgencyLevel } from "./timer";
import { Elapsed } from "@/components/motion/elapsed";
import { IconMic, IconClock, IconCalendar } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";
import { initials, money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ContactAvatar } from "@/components/ui/contact-avatar";

/**
 * O card do Quadro. Não escuta o relógio: o nível de urgência vem de `useUrgencyLevel` (re-renderiza só quando muda de "ok" para "atenção" para "atrasado")
 * e os cronômetros são folhas (`Elapsed`). Por isso 100 cards não re-renderizam a cada segundo e o `layout` do pai nunca é medido por causa do relógio.
 */
export const DealCard = memo(function DealCard({ card, slaMinutes, stageKind, stageName, dragging, filtersQs, a11y, opening }: {
  card: BoardCard; slaMinutes: number | null; stageKind: string; stageName?: string; dragging?: boolean; filtersQs: string;
  /** Atributos de acessibilidade do arrastar (instruções para leitor de tela), no link, que é quem recebe o foco. */
  a11y?: { "aria-describedby"?: string; "aria-roledescription"?: string };
  /** A folha de agendar, fechar venda ou perdido está abrindo para este card. */
  opening?: boolean;
}) {
  const urgency = useUrgencyLevel(card.awaitingReplySince, slaMinutes);
  const name = card.contactName?.trim() || formatPhoneClient(card.phone);
  const KIND: Record<string, string> = { audio: "Áudio", image: "Foto", sticker: "Figurinha", video: "Vídeo", document: "Documento", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem" };
  const snippet = card.lastMessage || (card.lastMessageKind ? KIND[card.lastMessageKind] ?? null : null);
  const waitingClient = !card.awaitingReplySince && card.lastDirection === "out" && card.lastMessageAt;
  return (
    <Link href={`/funil?${filtersQs}${filtersQs ? "&" : ""}lead=${card.id}`} scroll={false} draggable={false} {...a11y}
      className={cn(
        "group relative block rounded-[var(--radius-control)] border bg-paper px-3.5 py-3 text-left transition-[border-color,box-shadow,background,transform] duration-200",
        urgency === "late" ? "border-alert bg-alert-soft shadow-[0_0_0_1px_var(--color-alert)]" : urgency === "warn" ? "border-gold/70" : "border-line hover:border-line-strong",
        dragging ? "shadow-[var(--shadow-pop)] rotate-[1.5deg] scale-[1.02]" : "shadow-[var(--shadow-card)] hover:shadow-[0_6px_18px_-10px_rgb(40_30_15/0.25)] hover:-translate-y-px",
      )}>
      {opening && <span role="status" className="absolute inset-0 z-10 grid place-items-center rounded-[var(--radius-control)] bg-paper/75 text-sm font-medium text-graphite">Abrindo…</span>}
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-base leading-tight min-w-0 flex items-center gap-2">
          <ContactAvatar contactId={card.contactId} hasAvatar={card.hasAvatar} name={name} size={28}
            className={urgency === "late" ? "ring-2 ring-alert ring-offset-1 ring-offset-paper" : undefined} />
          <span className="truncate">{name}</span>
        </p>
        {card.ownerName && <span title={card.ownerName} className="size-6 shrink-0 rounded-full bg-paper-3 text-graphite text-[10px] font-semibold grid place-items-center">{initials(card.ownerName)}</span>}
      </div>
      <p className="text-xs text-muted mt-0.5 truncate">{card.origin}{card.isClient ? " · já é cliente" : ""}</p>
      {snippet && (
        <p className={cn("text-sm mt-2 line-clamp-2 leading-snug", card.lastDirection === "in" ? "text-ink-2" : "text-graphite")}>
          {card.lastMessageKind === "audio" && <IconMic size={13} className="inline -mt-0.5 mr-1" />}
          {card.lastDirection === "out" && <span className="text-muted">Você: </span>}{snippet}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 mt-2.5 min-h-[20px]">
        <div className="flex gap-1.5 min-w-0">
          {stageKind === "followup" && stageName && <span className="h-5 px-1.5 rounded-[5px] bg-paper-3 text-graphite text-[10.5px] font-semibold grid place-items-center whitespace-nowrap">{stageName}</span>}
          {stageKind === "agendado" && card.scheduledAt && (
            <span className="h-5 px-1.5 rounded-[5px] bg-gold-soft text-gold-ink text-[10.5px] font-semibold inline-flex items-center gap-1 whitespace-nowrap" suppressHydrationWarning>
              <IconCalendar size={11} />{new Date(card.scheduledAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" })}
            </span>
          )}
          {stageKind === "fechado" && card.valueCents != null && <span className="h-5 px-1.5 rounded-[5px] bg-ok-soft text-ok text-[10.5px] font-semibold grid place-items-center">{money(card.valueCents)}</span>}
        </div>
        {card.awaitingReplySince ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular whitespace-nowrap",
            urgency === "late" ? "text-alert" : urgency === "warn" ? "text-gold-ink" : "text-ink-2")}>
            <IconClock size={13} aria-hidden /><span className="sr-only">Sua vez, esperando resposta há </span><span aria-hidden>Sua vez · </span>
            <Elapsed since={card.awaitingReplySince} sla={slaMinutes} />
          </span>
        ) : waitingClient ? (
          <span className="text-xs text-muted whitespace-nowrap">Aguardando cliente · <Elapsed since={card.lastMessageAt} sla={null} wall /></span>
        ) : null}
      </div>
    </Link>
  );
});
