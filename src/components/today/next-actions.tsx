"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { TodayTask } from "@/server/queries/today";
import { completeTaskAction } from "@/app/(app)/funil/actions";
import { IconCheck } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { dueLabel } from "@/lib/next-action";
import { leadHref } from "@/lib/lead-href";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";

/**
 * "Minhas próximas ações": o que venceu e o que vence hoje, vencidas primeiro. Concluir é um toque (o servidor resolve o aviso da tarefa);
 * o item sai da lista e o nome do cliente leva ao lead na Fila.
 */
export function NextActions({ items, nowMs }: { items: TodayTask[]; nowMs: number }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const list = items.filter((t) => !gone.has(t.id));

  const done = (t: TodayTask) => start(async () => {
    const r = await completeTaskAction(t.id);
    if (!r.ok) { toast(r.error, "error"); return; }
    setGone((g) => new Set(g).add(t.id));
    toast(`Concluída: ${t.title}`);
  });

  if (!list.length) return <p className="px-5 pb-4 text-sm text-muted">Nenhuma ação vencida nem marcada para hoje. Defina a próxima ação de um lead na Fila.</p>;
  return (
    <ul className="relative px-2 pb-2">
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((t) => (
          <motion.li key={t.id} layout="position" data-testid="proxima-acao-item"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 24, transition: { duration: DUR.base, ease: EASE } }} transition={SPRING}
            className="flex items-center gap-2 border-t border-line/70 px-3 py-1.5 first:border-t-0">
            <Link href={t.dealId ? leadHref(t.dealId) : `/contatos/${t.contactId}`} className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1 rounded-[var(--radius-control)]">
              <span className="text-base font-medium leading-snug">{t.title}</span>
              <span className="text-sm leading-snug text-graphite">
                {t.name} · <span className={cn("tabular", t.overdue && "font-semibold text-alert")}>{t.overdue ? "atrasada " : ""}{dueLabel(new Date(t.dueAt).getTime(), nowMs)}</span>
              </span>
            </Link>
            <button type="button" disabled={pending} onClick={() => done(t)} aria-label={`Concluir: ${t.title}`}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border border-ok/40 bg-paper px-3 text-sm font-medium text-ok transition-colors hover:bg-ok-soft disabled:opacity-60">
              <IconCheck size={14} aria-hidden />Concluir
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}
