import type { Comparison } from "@/lib/report-format";

/** Comparação com o período anterior: seta + variação sempre escritas; cor só quando o tom não é neutro (amostra suficiente). */
export function Delta({ c, prevText, className = "" }: { c: Comparison; prevText?: string; className?: string }) {
  const color = c.tone === "good" ? "text-ok" : c.tone === "bad" ? "text-alert" : "text-graphite";
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 text-sm tabular ${className}`}>
      <span className={`font-medium ${color}`}>{c.text}</span>
      {prevText && c.direction !== "none" && !c.text.includes("antes:") && <span className="text-muted">{prevText}</span>}
    </span>
  );
}
