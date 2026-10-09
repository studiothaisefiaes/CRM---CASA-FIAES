"use client";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { IconClose } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { isTop, popModal, pushModal } from "@/components/ui/modal-stack";

const FOCUSABLE = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";

/** Folha lateral (desktop) ou inferior (celular): foco preso, Esc fecha, o foco volta a quem abriu. */
export function Sheet({ open, onClose, title, labelledBy, side = "right", initialFocusRef, children, footer, className }: {
  open: boolean; onClose: () => void; title: string;
  /** id de um elemento que já nomeia a folha; sem ele, o `title` é o nome. */
  labelledBy?: string; side?: "right" | "bottom"; initialFocusRef?: RefObject<HTMLElement | null>;
  children?: ReactNode; footer?: ReactNode; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  // Quem abriu: capturado só na abertura (e devolvido ao fechar), não a cada render.
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    return () => { prev?.focus?.(); };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = pushModal();
    const t = setTimeout(() => {
      if (!isTop(id)) return;
      const all = [...(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
      const first = initialFocusRef?.current ?? all.find((el) => !el.hasAttribute("data-close")) ?? all[0];
      first?.focus();
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (!isTop(id)) return; // há um diálogo por cima: ele cuida de Tab e Esc
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopImmediatePropagation(); onCloseRef.current(); }
      if (e.key === "Tab" && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!f.length) { e.preventDefault(); return; }
        const a = document.activeElement;
        if (!ref.current.contains(a)) { e.preventDefault(); f[0].focus(); }
        else if (e.shiftKey && a === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); popModal(id); };
  }, [open, initialFocusRef]);

  const right = side === "right";
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70]">
          <motion.div className="absolute inset-0 bg-ink/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? titleId}
            initial={right ? { x: "100%" } : { y: "100%" }} animate={right ? { x: 0 } : { y: 0 }} exit={right ? { x: "100%" } : { y: "100%" }} transition={SPRING}
            className={cn(
              "absolute flex flex-col bg-paper shadow-[var(--shadow-pop)]",
              right ? "inset-y-0 right-0 w-full max-w-[480px] border-l border-line" : "inset-x-0 bottom-0 max-h-[90dvh] border-t border-line rounded-t-[var(--radius-panel)]",
              className,
            )}
          >
            <div className="flex items-start justify-between gap-4 px-5 pt-4 pb-3 border-b border-line">
              <h2 id={labelledBy ? undefined : titleId} className="font-serif text-xl leading-tight font-light pt-1">{title}</h2>
              <IconButton data-close label="Fechar" onClick={onClose} className="-mr-2"><IconClose size={16} /></IconButton>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scroll-thin px-5 py-4">{children}</div>
            {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 bg-paper-2/50">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
