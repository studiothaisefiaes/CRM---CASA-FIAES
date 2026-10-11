"use client";
import { useClock, useHours, urgencyOf, fmtWait } from "@/components/pipeline/timer";
import { businessSecondsBetween } from "@/lib/business-hours";
import { elapsed } from "@/lib/format";
import { cn } from "@/lib/cn";

/**
 * O cronômetro de espera, como folha: é o único pedaço da tela que escuta o relógio. O pai nunca re-renderiza por causa dele,
 * e a folha em si só re-renderiza quando o TEXTO muda (a cada minuto, não a cada segundo). Sem `since`, não renderiza nada.
 * `data-urgency` ("ok" | "warn" | "late") deixa o CSS pintar o estado sem o pai saber. `format` troca o texto (padrão: "5 min", "1 h 05").
 */
export function Elapsed({ since, sla, format = fmtWait, wall, prefix, className }: {
  since: string | null; sla: number | null; format?: (seconds: number) => string; /** Tempo corrido no relógio de parede (com dias), sem o horário de atendimento. */ wall?: boolean; prefix?: string; className?: string;
}) {
  const hours = useHours();
  const t = since ? new Date(since).getTime() : null;
  // Servidor e primeira pintura contam espera zero; o relógio real entra logo depois, sem divergência de hidratação.
  const key = useClock((now) => (t == null ? "" : `${urgencyOf(since, sla, now, hours)}|${wall ? elapsed(since!, now) : format(businessSecondsBetween(t, now, hours))}`), t ?? undefined);
  if (t == null) return null;
  const i = key.indexOf("|");
  return <span suppressHydrationWarning data-urgency={key.slice(0, i)} className={cn("tabular", className)}>{prefix}{key.slice(i + 1)}</span>;
}
