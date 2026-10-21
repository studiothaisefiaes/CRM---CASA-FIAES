"use client";
import type { DealDetail } from "@/server/queries/deal";
import { Button } from "@/components/ui/button";
import { IconCheck, IconPlus } from "@/components/icons";
import { useNow } from "@/components/pipeline/timer";
import { answeredAfterDue, dueLabel } from "@/lib/next-action";
import { cn } from "@/lib/cn";
import type { LeadActions } from "./use-lead-actions";

/** Quando e quem, numa linha: "hoje 18:00 · Ana". Passou do horário: "atrasado · ontem 10:00 · Ana". Folha própria: bate o relógio. */
function DueLine({ dueAt, assignee }: { dueAt: string | Date; assignee: string | null }) {
  const now = useNow();
  const due = new Date(dueAt).getTime();
  const late = due < now;
  return (
    <p data-testid="proxima-acao-quando" className={cn("text-sm", late ? "font-medium text-alert" : "text-graphite")} suppressHydrationWarning>
      <span suppressHydrationWarning>{late ? "atrasado · " : ""}{dueLabel(due, now)}</span>
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
  const now = useNow();
  // Vencido e a Casa já escreveu depois: provavelmente já foi feito; o Concluir vira "Marcar como feito" e diz por quê.
  const answered = !!na && answeredAfterDue(new Date(na.dueAt).getTime(), d.deal.lastOutboundAt ? new Date(d.deal.lastOutboundAt).getTime() : null, now);
  return (
    <section aria-label="Combinado" className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold text-muted">Combinado</h4>
      {na ? (
        <div className="flex flex-col gap-2.5 rounded-[var(--radius-card)] border border-line bg-paper px-3.5 py-3">
          <div className="min-w-0">
            <p data-testid="proxima-acao-titulo" className="text-md font-medium leading-snug text-ink lg:text-base">{na.title}</p>
            <DueLine dueAt={na.dueAt} assignee={na.assigneeName} />
            {answered && <p className="mt-0.5 text-sm text-gold-ink">A Casa já escreveu depois: se já resolveu, marque como feito.</p>}
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button variant="secondary" size="sm" className="pointer-coarse:min-h-11" disabled={actions.busy} onClick={() => actions.completeTask(na.id, na.title)}>
              <IconCheck size={15} aria-hidden />{answered ? "Marcar como feito" : "Concluir"}
            </Button>
            <Button variant="ghost" size="sm" className="pointer-coarse:min-h-11" disabled={actions.busy} onClick={() => actions.open("next")}>Trocar</Button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={actions.busy} onClick={() => actions.open("next")}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-dashed border-line-strong px-3.5 text-sm font-medium text-graphite transition-colors hover:border-ink hover:text-ink disabled:opacity-60 lg:min-h-10">
          <IconPlus size={15} aria-hidden />Combinado
        </button>
      )}
    </section>
  );
}
