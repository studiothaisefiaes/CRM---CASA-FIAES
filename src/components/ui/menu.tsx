"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** Menu de ações: abre pelo botão, setas/Home/End navegam, Esc fecha e devolve o foco ao botão. */
export function Menu({ trigger, items, label, align = "right", className }: {
  trigger: ReactNode; items: MenuItem[];
  /** Nome acessível do botão quando `trigger` é só um ícone. */
  label?: string; align?: "left" | "right"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const focusItem = (i: number) => {
    const els = list.current?.querySelectorAll<HTMLElement>("[role=menuitem]");
    if (els?.length) els[(i + els.length) % els.length].focus();
  };
  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) btn.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => focusItem(0), 20);
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  const onListKey = (e: KeyboardEvent) => {
    const els = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(-1); }
    else if (e.key === "Tab") setOpen(false);
  };
  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
  };

  return (
    <div ref={wrap} className={cn("relative inline-block", className)}>
      <button
        ref={btn} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={label}
        onClick={() => setOpen((o) => !o)} onKeyDown={onBtnKey}
        className="inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-graphite hover:text-ink hover:bg-paper-2 transition-colors min-h-8 min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={list} id={id} role="menu" aria-label={label} onKeyDown={onListKey}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: DUR.fast, ease: EASE }}
            className={cn("absolute z-50 top-full mt-1.5 min-w-44 p-1 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)]", align === "right" ? "right-0" : "left-0")}
          >
            {items.map((it) => (
              <button
                key={it.label} type="button" role="menuitem" tabIndex={-1}
                onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}
                className={cn("w-full text-left px-3 h-9 pointer-coarse:h-11 rounded-[8px] text-base focus:outline-none transition-colors", it.danger ? "text-alert hover:bg-alert-soft focus:bg-alert-soft" : "text-ink hover:bg-paper-2 focus:bg-paper-2")}
              >
                {it.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
