"use client";
import { useId, useRef, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";

export type TabItem<T extends string = string> = { value: T; label: string; count?: number };

/** Abas com seletor deslizante. Setas, Home e End trocam de aba (ativação automática). */
export function Tabs<T extends string = string>({ value, onChange, items, label, className, idPrefix }: {
  value: T; onChange: (v: T) => void; items: TabItem<T>[]; label?: string; className?: string;
  /** Com prefixo, cada aba ganha id `${idPrefix}-tab-${valor}` e `aria-controls="${idPrefix}-panel"` (o painel usa o mesmo par de ids). */
  idPrefix?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const go = (i: number) => {
    const n = (i + items.length) % items.length;
    onChange(items[n].value);
    refs.current[n]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); go(0); }
    else if (e.key === "End") { e.preventDefault(); go(items.length - 1); }
  };
  const active = Math.max(0, items.findIndex((t) => t.value === value));
  return (
    <div role="tablist" aria-label={label} className={cn("flex gap-1 bg-paper-2 rounded-[var(--radius-control)] p-1", className)}>
      {items.map((t, i) => {
        const on = i === active;
        return (
          <button
            key={t.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={idPrefix ? `${idPrefix}-tab-${t.value}` : `${id}-${t.value}`} aria-controls={idPrefix ? `${idPrefix}-panel` : undefined}
            aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => onChange(t.value)} onKeyDown={(e) => onKey(e, i)}
            className={cn("relative flex-1 h-8 px-3 text-sm font-medium rounded-[8px] transition-colors pointer-coarse:min-h-11", on ? "text-ink" : "text-graphite hover:text-ink")}
          >
            {on && <motion.span layoutId={`${id}-pill`} transition={SPRING} className="absolute inset-0 rounded-[8px] bg-paper shadow-[var(--shadow-card)] border border-line" />}
            <span className="relative inline-flex items-center justify-center gap-1.5">
              {t.label}
              {t.count != null && <span className="tabular text-xs text-muted">{t.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
