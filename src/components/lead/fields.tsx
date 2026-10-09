"use client";
import { useState, useTransition, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { updateDealAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { IconCheck } from "@/components/icons";
import { parseBRL } from "@/lib/money";
import type { DealPatch } from "@/server/domain/updates";

type Kind = "text" | "email" | "textarea" | "select" | "datetime" | "date" | "money" | "birthday";

/** Campo que salva sozinho ao sair (blur/troca). Mostra "salvo" por um instante. */
export function AutoField({ dealId, name, label, value, kind = "text", options, placeholder, icon }: {
  dealId: string; name: keyof DealPatch; label: string; value: string; kind?: Kind; options?: { value: string; label: string }[]; placeholder?: string; icon?: ReactNode;
}) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) { setPrevValue(value); setV(value); }

  const save = (next = v) => {
    if (next === value) { setErr(null); return; }
    let payload: unknown = next;
    if (kind === "datetime") payload = next ? new Date(next).toISOString() : null;
    if (kind === "date") payload = next ? new Date(next + "T10:00").toISOString() : null;
    if (kind === "money") {
      if (!next.trim()) payload = null;
      else {
        const r = parseBRL(next);
        if (!r.ok) { setErr(r.error); return; }
        payload = r.cents;
      }
    }
    if (kind === "select" || kind === "textarea" || kind === "text" || kind === "email" || kind === "birthday") payload = next === "" ? (name === "origin" ? undefined : null) : next;
    start(async () => {
      const r = await updateDealAction(dealId, { [name]: payload } as DealPatch);
      if (!r.ok) { setErr(r.error); toast(r.error, "error"); return; }
      setErr(null); setSaved(true); setTimeout(() => setSaved(false), 1400);
    });
  };

  const cls = `w-full bg-transparent rounded-[8px] px-2 -mx-2 py-1.5 text-md md:text-base outline-none border border-transparent hover:border-line focus:border-ink focus:bg-paper focus:shadow-[0_0_0_3px_rgb(184_134_63/0.18)] transition-[border-color,box-shadow,background] ${err ? "border-alert" : ""}`;
  return (
    <label className="block group">
      <span className="flex items-center justify-between text-xs font-medium text-muted mb-0.5">
        <span className="inline-flex items-center gap-1.5">{icon}{label}</span>
        <AnimatePresence>{(saved || pending) && (
          <motion.span initial={{ opacity: 0, x: 4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="inline-flex items-center gap-1 text-ok text-xs">
            {pending ? "salvando…" : <><IconCheck size={12} /> salvo</>}
          </motion.span>)}
        </AnimatePresence>
      </span>
      {kind === "textarea" ? (
        <textarea aria-invalid={err ? true : undefined} value={v} placeholder={placeholder} rows={3} onChange={(e) => setV(e.target.value)} onBlur={() => save()} className={`${cls} resize-y leading-relaxed`} />
      ) : kind === "select" ? (
        <select aria-invalid={err ? true : undefined} value={v} onChange={(e) => { setV(e.target.value); save(e.target.value); }} className={`${cls} appearance-none cursor-pointer`}>
          <option value="">—</option>{options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : (
        <input aria-invalid={err ? true : undefined} value={v} placeholder={placeholder} type={kind === "datetime" ? "datetime-local" : kind === "date" ? "date" : kind === "email" ? "email" : "text"}
          inputMode={kind === "money" ? "decimal" : undefined} onChange={(e) => setV(e.target.value)} onBlur={() => save()}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} className={cls} />
      )}
      {err && <span role="alert" className="block text-xs text-alert mt-0.5">{err}</span>}
    </label>
  );
}
