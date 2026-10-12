import Link from "next/link";
import type { BulkOptions, QueueResult } from "@/server/queries/queue";
import { QueueListRoute } from "./queue-route";
import { QueueSummary } from "./queue-summary";
import { QueueFilters } from "./queue-filters";
import { HideWhileSelecting, QueueSelectionProvider, SelectToggle } from "./queue-selection";
import { AttendanceStrip } from "./attendance-strip";
import { FILTER_LABEL, type QueueFilter } from "@/lib/report-links";
import type { QueueFoco, QueueView } from "@/lib/queue";
import { cn } from "@/lib/cn";

/** O painel da esquerda da Fila: resumo, busca, visões e a lista (o título e as abas ficam na `WorkspaceBar`, acima). Usado por /atendimento e por /atendimento/[id] (no desktop). */
export function QueueColumn({ queue, query, view, foco, filtro, q, fonte, etapaName, onlyOwnLabel, selectedId, className, bulk }: {
  queue: QueueResult; query: string; view: QueueView; foco: QueueFoco | null; filtro: QueueFilter | null; q: string | null; fonte: string | null;
  /** Nome da etapa do `?etapa=` (link da Jornada): vira o aviso "Mostrando: etapa …". */
  etapaName?: string | null;
  /** "(só os seus)" no aviso do filtro vindo de relatório, para a atendente. */
  onlyOwnLabel: boolean; selectedId: string | null; className?: string; bulk: BulkOptions;
}) {
  return (
    <QueueSelectionProvider>
    <section aria-label="Fila de atendimento" className={cn("min-h-0 flex-col bg-paper lg:border-r border-line", className ?? "flex")}>
      <div className="shrink-0 px-4 pt-2 pb-3 border-b border-line">
        <div className="flex items-start justify-between gap-2">
          <HideWhileSelecting className="min-w-0 flex-1"><QueueSummary counts={queue.counts} view={view} foco={foco} filtro={filtro} /></HideWhileSelecting>
          <SelectToggle className="mt-2.5 ml-auto shrink-0" />
        </div>
        {(filtro || etapaName) && (
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
            <span className="rounded-full bg-gold-soft text-gold-ink px-3 py-1 font-medium">Mostrando: {[filtro ? FILTER_LABEL[filtro].toLowerCase() : null, etapaName ? `etapa ${etapaName}` : null].filter(Boolean).join(" · ")}{filtro && onlyOwnLabel ? " (só os seus)" : ""}{filtro && fonte ? ` · origem ${fonte}` : ""}</span>
            <Link href="/atendimento?view=todos" replace className="inline-flex items-center min-h-11 lg:min-h-8 text-graphite underline underline-offset-2 hover:text-ink">Mostrar todos</Link>
          </p>
        )}
        <HideWhileSelecting><QueueFilters view={view} q={q ?? ""} counts={queue.counts} /></HideWhileSelecting>
        {queue.truncated && <p role="status" className="mt-2 text-xs text-muted">Mostrando {queue.truncated.shown} de {queue.truncated.total} conversas. Use a busca ou uma visão para ver as outras.</p>}
      </div>
      <AttendanceStrip items={queue.conferir} />
      <QueueListRoute sections={queue.sections} query={query} selectedId={selectedId} className="flex-1" bulk={bulk} />
    </section>
    </QueueSelectionProvider>
  );
}
