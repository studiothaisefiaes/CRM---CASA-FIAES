"use client";
import Link from "next/link";
import type { BoardCard } from "@/server/queries/board";
import { memo } from "react";
import { useUrgencyLevel } from "./timer";
import { Elapsed } from "@/components/motion/elapsed";
import { IconMic, IconClock, IconCalendar } from "@/components/icons";
import { formatPhoneClient, nameFallback } from "@/lib/phone-client";
import { initials, money } from "@/lib/format";
import { cn } from "@/lib/cn";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { lastMessagePrefix, ownerLine } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";
import { attemptLabel } from "@/lib/attempts";
import { audioPreview } from "@/lib/audio";
import { originLabel } from "@/lib/origin-label";
import { retomarVencida } from "@/lib/conversation-status";

/**
 * O card do Quadro. Não escuta o relógio: o nível de urgência vem de `useUrgencyLevel` (re-renderiza só quando muda de "ok" para "atenção" para "atrasado")
 * e os cronômetros são folhas (`Elapsed`). Por isso 100 cards não re-renderizam a cada segundo e o `layout` do pai nunca é medido por causa do relógio.
 */
export const DealCard = memo(function DealCard({ card, slaMinutes, stageKind, dragging, filtersQs, a11y, opening }: {
  card: BoardCard; slaMinutes: number | null; stageKind: string; dragging?: boolean; filtersQs: string;
  /** Atributos de acessibilidade do arrastar (instruções para leitor de tela), no link, que é quem recebe o foco. */
  a11y?: { "aria-describedby"?: string; "aria-roledescription"?: string };
  /** A folha de agendar, fechar venda ou perdido está abrindo para este card. */
  opening?: boolean;
}) {
  const alert = card.urgency === "late"; // alerta aberto (do servidor): a única coisa que pinta de vermelho
  const urgency = useUrgencyLevel(card.awaitingReplySince, slaMinutes, alert);
  const name = card.contactName?.trim() || nameFallback(card.phone);
  const KIND: Record<string, string> = { text: "Mensagem", audio: "Áudio", image: "Foto", sticker: "Figurinha", video: "Vídeo", document: "Documento", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem" };
  const snippet = (card.lastMessage ? stripSignature(card.lastMessage) : "")
    || (card.lastMessageKind === "audio" ? audioPreview(card.lastMessageDurationSec, card.lastMessageTranscript) : card.lastMessageKind ? KIND[card.lastMessageKind] ?? null : null);
  const prefix = lastMessagePrefix(card.lastDirection, card.lastAuthorName, card.lastMessage);
  const waitingClient = !card.awaitingReplySince && card.lastDirection === "out" && card.lastMessageAt;
  return (
    <Link href={`/funil?${filtersQs}${filtersQs ? "&" : ""}lead=${card.id}`} scroll={false} draggable={false} {...a11y}
      className={cn(
        "group relative block rounded-[var(--radius-control)] border bg-paper px-3.5 py-3 text-left transition-[border-color,box-shadow,background,transform] duration-200",
        urgency === "late" ? "border-alert bg-alert-soft shadow-[0_0_0_1px_var(--color-alert)]" : urgency === "warn" ? "border-gold/70" : card.esperando ? "border-alert/60 border-l-4" : "border-line hover:border-line-strong",
        dragging ? "shadow-[var(--shadow-pop)] rotate-[1.5deg] scale-[1.02]" : "shadow-[var(--shadow-card)] hover:shadow-[0_6px_18px_-10px_rgb(40_30_15/0.25)] hover:-translate-y-px",
      )}>
      {opening && <span role="status" className="absolute inset-0 z-10 grid place-items-center rounded-[var(--radius-control)] bg-paper/75 text-sm font-medium text-graphite">Abrindo…</span>}
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-base leading-tight min-w-0 flex items-center gap-2">
          <ContactAvatar contactId={card.contactId} hasAvatar={card.hasAvatar} name={name} size={28}
            className={urgency === "late" ? "ring-2 ring-alert ring-offset-1 ring-offset-paper" : undefined} />
          <span className="truncate">{name}</span>
        </p>
        {card.ownerName && <span title={`Dona: ${card.ownerShort ?? card.ownerName}`} className="size-6 shrink-0 rounded-full bg-paper-3 text-graphite text-xs font-semibold grid place-items-center">{initials(card.ownerName)}</span>}
      </div>
      <p className="text-xs text-muted mt-0.5 truncate">{originLabel(card.origin)}{card.isClient ? " · já é cliente" : ""}{card.repliedByName ? ` · ${ownerLine(card.ownerShort ?? card.ownerName, card.repliedByName)}` : ""}</p>
      {snippet && (
        <p className={cn("text-sm mt-2 line-clamp-2 leading-snug", card.lastDirection === "in" ? "text-ink-2" : "text-graphite")}>
          {card.lastMessageKind === "audio" && <IconMic size={13} className="inline -mt-0.5 mr-1" />}
          {prefix && <span className="text-muted">{prefix}</span>}{snippet}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mt-2.5 min-h-[20px]">
        <div className="flex gap-1.5 min-w-0">
          {(stageKind === "followup" || stageKind === "proposta") && attemptLabel(card.followupAttempt) && (
            <span className="h-5 px-1.5 rounded-[5px] bg-paper-3 text-graphite text-xs font-semibold grid place-items-center whitespace-nowrap">{attemptLabel(card.followupAttempt)}</span>
          )}
          {card.pkg && <span className="h-5 px-1.5 rounded-[5px] bg-paper-3 text-graphite text-xs font-semibold grid place-items-center whitespace-nowrap">Pacote {card.pkg.used}/{card.pkg.total}</span>}
          {stageKind === "retomar" && card.retomarAt && (
            <span className="h-5 px-1.5 rounded-[5px] text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap" suppressHydrationWarning
              style={retomarVencida(card.retomarAt) ? { backgroundColor: "#b3261e1a", color: "#b3261e" } : { backgroundColor: "#6b4fa31a", color: "#6b4fa3" }}>
              <IconClock size={11} />Retomar {retomarVencida(card.retomarAt) ?? new Date(card.retomarAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" }).replace(/,/g, "")}
            </span>
          )}
          {card.stageName && <span className="h-5 px-1.5 rounded-[5px] bg-paper-3 text-graphite text-xs font-semibold grid place-items-center whitespace-nowrap">{card.stageName}</span>}
          {(stageKind === "agendado" || card.stageName) && card.scheduledAt && (
            <span className="h-5 px-1.5 rounded-[5px] bg-gold-soft text-gold-ink text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap" suppressHydrationWarning>
              <IconCalendar size={11} />{new Date(card.scheduledAt).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" })}
            </span>
          )}
          {stageKind === "fechado" && card.valueCents != null && <span className="h-5 px-1.5 rounded-[5px] bg-ok-soft text-ok text-xs font-semibold grid place-items-center">{money(card.valueCents)}</span>}
        </div>
        {card.awaitingReplySince ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tabular whitespace-nowrap",
            urgency === "late" ? "text-alert" : urgency === "warn" ? "text-gold-ink" : "text-ink-2")}>
            <IconClock size={13} aria-hidden /><span className="sr-only">Esperando resposta há </span><span aria-hidden>Esperando · </span>
            <Elapsed since={card.awaitingReplySince} sla={slaMinutes} alert={alert} />
          </span>
        ) : waitingClient ? (
          <span className="text-xs text-muted whitespace-nowrap">Aguardando cliente · <Elapsed since={card.lastMessageAt} sla={null} wall /></span>
        ) : null}
      </div>
    </Link>
  );
});
