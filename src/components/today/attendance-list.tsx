"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { AttendanceDue } from "@/server/queries/today";
import { setAttendanceAction, undoMissedAttendanceAction } from "@/app/(app)/funil/actions";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconChat, IconCheck, IconClose } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { attendanceToast } from "@/components/queue/use-lead-actions";
import { hidePhone } from "@/lib/hide-phone";
import { dueLabel } from "@/lib/next-action";
import { leadHref } from "@/lib/lead-href";
import { ClientLink } from "@/components/contacts/client-link";
import { T, EASE, SPRING_UI } from "@/lib/motion";
import { cn } from "@/lib/cn";

/**
 * "Comparecimentos de ontem": os agendados sem Compareceu/Faltou (de ontem e os de hoje cujo horário já passou), com os dois botões ali mesmo.
 * Marcado, o item sai da lista (saída só com opacity/transform; o resto sobe por `layout`) e o aviso diz o resultado. Faltou cria o "Remarcar" no servidor.
 */
export function AttendanceList({ items, nowMs, limit }: { items: AttendanceDue[]; nowMs: number; limit?: number }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const list = items.filter((i) => !gone.has(i.dealId)).slice(0, limit);

  const confirmNoShow = useConfirmNoShow();
  const doMark = (i: AttendanceDue, status: "compareceu" | "faltou") => start(async () => {
    const r = await setAttendanceAction(i.dealId, status);
    if (!r.ok) { toast(r.error, "error"); return; }
    setGone((g) => new Set(g).add(i.dealId));
    const name = hidePhone(i.name);
    // Faltou tem Desfazer (QA r58, M-2): a conversa volta como estava e o item volta para a lista.
    const undo = status === "faltou" && r.data?.changed ? { label: "Desfazer", onClick: () => start(async () => {
      const u = await undoMissedAttendanceAction(i.dealId);
      if (!u.ok) { toast(u.error, "error"); return; }
      setGone((g) => { const n = new Set(g); n.delete(i.dealId); return n; });
      toast(`Desfeito: ${name} voltou para a lista`);
    }) } : undefined;
    toast(attendanceToast(name, status, r.data), r.data?.changed ? "ok" : "info", undo);
  });
  const mark = (i: AttendanceDue, status: "compareceu" | "faltou") => (status === "faltou"
    ? confirmNoShow({ who: hidePhone(i.name), detail: dueLabel(new Date(i.scheduledAt).getTime(), nowMs), onConfirm: () => doMark(i, status) })
    : doMark(i, status));

  if (!list.length) return <p className="px-5 pb-4 text-sm text-muted">Nada para conferir. Todos os agendamentos que já passaram estão marcados.</p>;
  return (
    <ul className="relative px-2 pb-2">
      <AnimatePresence initial={false} mode="popLayout">
        {list.map((i) => {
          const name = hidePhone(i.name);
          return (
            <motion.li key={i.dealId} layout="position" data-testid="comparecimento-item"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: 24, transition: { duration: T.base, ease: EASE } }} transition={SPRING_UI}
              className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line/70 px-3 py-2 first:border-t-0">
              <span className="flex min-h-11 min-w-0 flex-1 basis-40 items-center gap-2.5">
                <ClientLink contactId={i.contactId} name={name} className="flex min-w-0 items-center gap-2.5">
                  <ContactAvatar contactId={i.contactId} hasAvatar={i.hasAvatar} name={name} size={36} />
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium">{name}</span>
                    <span className="block text-sm text-graphite tabular">{dueLabel(new Date(i.scheduledAt).getTime(), nowMs)}</span>
                  </span>
                </ClientLink>
                <Link href={leadHref(i.dealId)} aria-label={`Abrir conversa com ${name}`} className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-control)] text-graphite hover:bg-paper-2 lg:size-9"><IconChat size={16} /></Link>
              </span>
              <span className="flex gap-2">
                {([["compareceu", "Veio", IconCheck], ["faltou", "Faltou", IconClose]] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button" disabled={pending} onClick={() => mark(i, value)} aria-label={`${label}: ${name}`}
                    className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-medium transition-colors disabled:opacity-60",
                      value === "compareceu" ? "border-ok/40 bg-paper text-ok hover:bg-ok-soft" : "border-alert/40 bg-paper text-alert hover:bg-alert-soft")}>
                    <Icon size={14} aria-hidden />{label}
                  </button>
                ))}
              </span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}
