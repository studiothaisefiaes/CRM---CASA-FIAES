"use client";
import { useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { IconClock } from "@/components/icons";
import { useClock } from "@/components/pipeline/timer";
import { cancelScheduledAction } from "@/app/(app)/conversa/actions";
import { dueLabel } from "@/lib/next-action";
import { firstName } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";
import type { LeadActions } from "./use-lead-actions";

export type ScheduledView = { id: string; text: string; at: string | Date; authorName: string | null; cancelIfReply: boolean; taskId?: string | null };
const BTN = "min-h-8 rounded-[10px] border border-line-strong bg-paper px-3 text-sm font-medium text-ink hover:border-ink disabled:opacity-60 pointer-coarse:min-h-11";

/**
 * A mensagem programada (Retomada com texto) logo acima do campo: "Retomada · sex 10:00 · sai sozinha", o texto e
 * Enviar agora / Editar / Cancelar. Editar abre o Retomar com o texto; Cancelar tira a retomada inteira (a mensagem e o lembrete).
 */
export function RetomadaStrip({ items, actions, onChange }: { items: ScheduledView[]; actions: LeadActions; onChange: () => void }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  const now = useClock((ms) => Math.floor(ms / 60_000) * 60_000);
  if (!items.length) return null;
  return (
    <ul aria-label="Mensagens programadas" className="shrink-0 flex flex-col gap-1.5 px-3 pt-2">
      {items.map((s) => (
        <li key={s.id} role="group" aria-label="Mensagem programada" className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-gold/40 bg-gold-soft/50 px-3 py-2 text-sm">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-gold-ink" suppressHydrationWarning>
            <IconClock size={14} aria-hidden />Retomada · {dueLabel(new Date(s.at).getTime(), now)} · sai sozinha{s.cancelIfReply ? " (não sai se ela responder antes)" : ""}
            {s.authorName && <span className="font-normal text-graphite"> · por {firstName(s.authorName)}</span>}
          </p>
          <p className="line-clamp-2 text-ink">{stripSignature(s.text)}</p>
          <div className="flex flex-wrap justify-end gap-1.5">
            <button type="button" className={BTN} disabled={pending} aria-label="Cancelar a mensagem programada"
              onClick={() => start(async () => {
                if (s.taskId) { actions.cancelResume(); return; }
                const r = await cancelScheduledAction(s.id);
                toast(r.ok ? "Mensagem programada cancelada" : r.error, r.ok ? "ok" : "error"); if (r.ok) onChange();
              })}>Cancelar</button>
            <button type="button" className={BTN} disabled={pending} onClick={() => actions.openResume({ text: stripSignature(s.text) })}>Editar</button>
            <button type="button" className="min-h-8 rounded-[10px] bg-ink px-3 text-sm font-semibold text-paper disabled:opacity-60 pointer-coarse:min-h-11" disabled={pending}
              onClick={() => actions.sendResumeNow(s.id)}>Enviar agora</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
