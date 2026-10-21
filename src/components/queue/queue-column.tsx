import type { BulkOptions, QueueResult } from "@/server/queries/queue";
import { QueueListRoute } from "./queue-route";
import { QueueSelectionProvider } from "./queue-selection";
import { AttendanceStrip } from "./attendance-strip";
import { QueueTop, type QueueFilterOptions } from "./queue-top";
import type { QueueParams } from "@/lib/queue";
import { cn } from "@/lib/cn";
import { queueTab } from "@/lib/queue-filters";
import type { TeamNow } from "@/server/queries/team-now";

/**
 * O painel da esquerda da Fila (desenho aprovado): busca e "Filtros", as três abas (Todas, Não lidas, Resolvidas) com "Selecionar",
 * os filtros ligados em chips e uma lista só. Usado por /atendimento e por /atendimento/[id] (no desktop).
 */
/** Quantas conversas a aba diz ter, quando nada além da aba filtra a lista (sem busca, visão, etapa, dona, etiqueta…); senão null. */
function expectedOf(queue: QueueResult, p: QueueParams): number | null {
  const extra = Object.entries(p).some(([k, v]) => v && !["aba", "foco", "view", "lead"].includes(k)) || (p.view && p.view !== "todos" && p.view !== "arquivadas" && p.view !== "resolvidas");
  if (extra) return null;
  const c = queue.counts;
  const t = queueTab(p);
  return t === "todas" ? c.todasTotal ?? c.total : t === "esperando" ? c.aguardando : t === "nao-lidas" ? c.naoLidas : t === "retomar" ? c.retomar : c.views.arquivadas;
}

export function QueueColumn({ queue, query, params, onlyOwnLabel, selectedId, className, bulk, team, options, programadas, progress }: {
  queue: QueueResult; query: string;
  /** Os parâmetros da Fila que estão na URL (abas, filtros, busca). */ params: QueueParams;
  /** "(só os seus)" no chip do filtro vindo de relatório, para a atendente. */
  onlyOwnLabel: boolean; selectedId: string | null; className?: string; bulk: BulkOptions;
  /** "Equipe agora", dentro do painel Filtros. */ team?: TeamNow;
  options: QueueFilterOptions;
  /** Mensagens programadas pendentes no escopo dela: a aba "Programadas N" (abre /atendimento/programadas). */ programadas?: number;
  /** "12 de 15 respondidas hoje" (Casa toda, sem ranking). */ progress?: { text: string; done: boolean } | null;
}) {
  return (
    <QueueSelectionProvider>
    <section aria-label="Fila de atendimento" className={cn("min-h-0 flex-col bg-paper lg:border-r border-line", className ?? "flex")}>
      <div className="shrink-0 flex flex-col gap-2 px-3.5 pt-3 pb-2.5 border-b border-line">
        <QueueTop params={params} counts={queue.counts} options={options} team={team} onlyOwn={onlyOwnLabel && !!params.filtro} programadas={programadas} progress={progress} />
        {queue.truncated && <p role="status" className="text-xs text-muted">Mostrando {queue.truncated.shown} de {queue.truncated.total} conversas. Use a busca ou um filtro para ver as outras.</p>}
      </div>
      <AttendanceStrip items={queue.conferir} />
      <QueueListRoute sections={queue.sections} query={query} selectedId={selectedId} className="flex-1" bulk={bulk} expected={expectedOf(queue, params)} />
    </section>
    </QueueSelectionProvider>
  );
}
