"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { IconClose } from "@/components/icons";

/** Diálogo modal: foco preso, Esc fecha, ação primária à direita. */
export function Dialog({ open, onClose, title, description, children, footer, width = 440 }: {
  open: boolean; onClose: () => void; title: string; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("input,select,textarea,button:not([data-close])")?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>("a,button,input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled"));
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4">
          <motion.div className="absolute inset-0 bg-ink/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby="dlg-title" style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.98 }} transition={SPRING}
            className="relative w-full bg-paper rounded-[var(--radius-panel)] shadow-[var(--shadow-pop)] border border-line">
            <div className="px-6 pt-5 pb-4">
              <div className="flex items-start justify-between gap-4">
                <h2 id="dlg-title" className="font-serif text-[24px] leading-tight font-light">{title}</h2>
                <button data-close onClick={onClose} className="size-8 -mr-2 -mt-1 grid place-items-center rounded-[8px] text-muted hover:bg-paper-2 hover:text-ink" aria-label="Fechar"><IconClose size={16} /></button>
              </div>
              {description && <div className="text-sm text-graphite mt-1.5">{description}</div>}
              {children && <div className="mt-5">{children}</div>}
            </div>
            {footer && <div className="px-6 py-4 border-t border-line flex justify-end gap-2 bg-paper-2/50 rounded-b-[var(--radius-panel)]">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
