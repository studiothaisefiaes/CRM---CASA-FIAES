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
import { ClientLink } from "@/components/contacts/client-link";
import { T, EASE, SPRING_UI } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { hidePhone } from "@/lib/hide-phone";
import { Tabs } from "@/components/ui/tabs";

/**
 * "Minhas próximas ações": o que venceu e o que vence hoje, vencidas primeiro. Concluir é um toque (o servidor resolve o aviso da tarefa);
 * o item sai da lista e o nome do cliente leva ao lead na Fila.
 */
export function NextActions({ items, nowMs, limit, empty = "Nenhum combinado vencido nem marcado para hoje. Combine o próximo passo de uma conversa na Fila." }: { items: TodayTask[]; nowMs: number; limit?: number; empty?: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const list = items.filter((t) => !gone.has(t.id)).slice(0, limit);

  const done = (t: TodayTask) => start(async () => {
    const r = await completeTaskAction(t.id);
    if (!r.ok) { toast(r.error, "error"); return; }
    setGone((g) => new Set(g).add(t.id));
    toast(`Concluída: ${t.title}`);
  });

  if (!list.length) return <p className="px-5 pb-4 text-sm text-muted">{empty}</p>;
  return (
    <ul className="relative px-2 pb-2">
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((t) => (
          <motion.li key={t.id} layout="position" data-testid="proxima-acao-item"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 24, transition: { duration: T.base, ease: EASE } }} transition={SPRING_UI}
            className="flex items-center gap-2 border-t border-line/70 px-3 py-1.5 first:border-t-0">
            <div className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1">
              <Link href={t.dealId ? leadHref(t.dealId) : `/contatos/${t.contactId}`} className="flex min-h-11 items-center self-start text-base font-medium leading-snug rounded-[var(--radius-control)] hover:underline underline-offset-4">{hidePhone(t.title, t.name, t.phone)}</Link>
              <span className="text-sm leading-snug text-graphite">
                <ClientLink contactId={t.contactId} name={t.name}>{t.name}</ClientLink> · <span className={cn("tabular", t.overdue && "font-semibold text-alert")}>{t.overdue ? "atrasado " : ""}{dueLabel(new Date(t.dueAt).getTime(), nowMs)}</span>
                {t.answeredAfter && <span className="block text-gold-ink">A Casa já escreveu depois: se já resolveu, marque como feito.</span>}
              </span>
            </div>
            <button type="button" disabled={pending} onClick={() => done(t)} aria-label={`${t.answeredAfter ? "Marcar como feito" : "Concluir"}: ${hidePhone(t.title, t.name, t.phone)}`}
              className={cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors disabled:opacity-60",
                t.answeredAfter ? "border-ok bg-ok text-white hover:brightness-95" : "border-ok/40 bg-paper text-ok hover:bg-ok-soft")}>
              <IconCheck size={14} aria-hidden />{t.answeredAfter ? "Marcar como feito" : "Concluir"}
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/**
 * "Minhas próximas ações" com a aba "Sem responsável" para a gestão: nada some em silêncio (antes, a gestão via "Nenhuma ação vencida" com 50
 * vencidas sem dono). Abre em "Sem responsável" quando a pessoa não tem nada e lá há pendência.
 */
export function NextActionsPanel({ mine, unassigned, nowMs, limit, idPrefix = "proximas" }: { mine: TodayTask[]; unassigned: TodayTask[] | null; nowMs: number; limit?: number; idPrefix?: string }) {
  const [tab, setTab] = useState<"minhas" | "sem">(!mine.length && unassigned?.length ? "sem" : "minhas");
  if (!unassigned) return <NextActions items={mine} nowMs={nowMs} limit={limit} />;
  return (
    <>
      <Tabs<"minhas" | "sem"> idPrefix={idPrefix} label="De quem" value={tab} onChange={setTab} className="mx-5 mb-2"
        items={[{ value: "minhas", label: "Meus", count: mine.length }, { value: "sem", label: "Sem responsável", count: unassigned.length }]} />
      <div id={`${idPrefix}-panel`} role="tabpanel" aria-labelledby={`${idPrefix}-tab-${tab}`}>
        {tab === "minhas" ? <NextActions items={mine} nowMs={nowMs} limit={limit} />
          : <NextActions items={unassigned} nowMs={nowMs} limit={limit} empty="Nenhum combinado sem responsável. Toda tarefa nova já vai para a dona da conversa ou para quem respondeu por último." />}
      </div>
    </>
  );
}
