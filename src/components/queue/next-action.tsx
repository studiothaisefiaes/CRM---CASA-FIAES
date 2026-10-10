"use client";
import type { DealDetail } from "@/server/queries/deal";
import { Button } from "@/components/ui/button";
import { IconCheck, IconPlus } from "@/components/icons";
import { useNow } from "@/components/pipeline/timer";
import { dueLabel } from "@/lib/next-action";
import { cn } from "@/lib/cn";
import type { LeadActions } from "./use-lead-actions";

/** Quando e quem, numa linha: "hoje 18:00 · Ana". Passou do horário: "atrasada · ontem 10:00 · Ana". Folha própria: bate o relógio. */
function DueLine({ dueAt, assignee }: { dueAt: string | Date; assignee: string | null }) {
  const now = useNow();
  const due = new Date(dueAt).getTime();
  const late = due < now;
  return (
    <p data-testid="proxima-acao-quando" className={cn("text-sm", late ? "font-medium text-alert" : "text-graphite")} suppressHydrationWarning>
      <span suppressHydrationWarning>{late ? "atrasada · " : ""}{dueLabel(due, now)}</span>
      <span aria-hidden> · </span>{assignee ? assignee.split(/\s+/)[0] : "sem responsável"}
    </p>
  );
}

/**
 * A próxima ação do lead: uma só, com texto, data e responsável. "Concluir" é um toque; "Trocar" abre a folha e a nova substitui a atual
 * (a antiga fica no histórico). Sem próxima ação, "+ Próxima ação" abre a folha curta.
 */
export function NextAction({ d, actions }: { d: DealDetail; actions: LeadActions }) {
  const na = d.nextAction;
  return (
    <section aria-label="Próxima ação" className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Próxima ação</h4>
      {na ? (
        <div className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border border-line bg-paper px-3.5 py-3">
          <div className="min-w-0">
            <p data-testid="proxima-acao-titulo" className="text-md font-medium leading-snug text-ink lg:text-base">{na.title}</p>
            <DueLine dueAt={na.dueAt} assignee={na.assigneeName} />
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button variant="secondary" size="sm" className="pointer-coarse:min-h-11" disabled={actions.busy} onClick={() => actions.completeTask(na.id, na.title)}>
              <IconCheck size={15} aria-hidden />Concluir
            </Button>
            <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={actions.busy} onClick={() => actions.open("next")}>Trocar</Button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={actions.busy} onClick={() => actions.open("next")}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong px-3.5 text-sm font-medium text-graphite transition-colors hover:border-ink hover:text-ink disabled:opacity-60 lg:min-h-10">
          <IconPlus size={15} aria-hidden />Próxima ação
        </button>
      )}
    </section>
  );
}
