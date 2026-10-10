"use client";
import { IconClock } from "@/components/icons";
import { useHours, useNow, urgencyOf } from "@/components/pipeline/timer";
import { whyLate } from "@/lib/why-late";
import { cn } from "@/lib/cn";

/**
 * Por que o lead está esperando, em uma linha (ver `whyLate`). Folha própria: é a única parte do painel que bate o relógio.
 * Atrasado = alerta; perto do prazo = dourado; esperando = neutro; "aguardando a cliente" = discreto.
 */
export function WhyLate({ awaitingSince, slaMinutes, lastAt, lastDirection }: {
  awaitingSince: string | null; slaMinutes: number | null; lastAt?: string | null; lastDirection?: "in" | "out" | null;
}) {
  const now = useNow();
  const hours = useHours();
  const waiting = !!awaitingSince;
  if (!waiting && lastDirection !== "out") return null;
  const urgency = urgencyOf(awaitingSince, slaMinutes, now, hours);
  const tone = !waiting ? "text-graphite" : urgency === "late" ? "bg-alert-soft text-alert border-alert" : urgency === "warn" ? "bg-gold-soft text-gold-ink border-gold" : "bg-paper-2 text-ink border-line-strong";
  return (
    <p data-testid="por-que-atrasou" className={cn("flex items-start gap-2 text-sm leading-snug", waiting && "rounded-[var(--radius-control)] border-l-4 px-3 py-2.5", tone)} suppressHydrationWarning>
      <IconClock size={16} className="mt-0.5 shrink-0" aria-hidden />
      <span suppressHydrationWarning>{whyLate({ awaitingSince, slaMinutes, lastAt, lastDirection }, hours, now)}</span>
    </p>
  );
}
