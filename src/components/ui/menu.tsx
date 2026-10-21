"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { T, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean; /** Opção em uso (aria-current): destaca em negrito. */ current?: boolean; /** Segunda linha discreta (ex.: "Disponível · 2 esperando"). */ detail?: string };

/**
 * Menu de ações: abre pelo botão, setas/Home/End navegam, Esc fecha e devolve o foco ao botão.
 * A lista abre num portal com posição fixa: nunca é cortada por um pai com rolagem (ex.: a faixa do cabeçalho da conversa).
 */
export function Menu({ trigger, items, label, align = "right", up = false, className, triggerClassName }: {
  trigger: ReactNode; items: MenuItem[];
  /** Nome acessível do botão quando `trigger` é só um ícone. */
  label?: string; align?: "left" | "right"; /** Abre para cima (menus no rodapé da tela). */ up?: boolean; className?: string; triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const [pos, setPos] = useState<CSSProperties | null>(null);
  // Posição a partir do botão; acompanha rolagem e redimensionamento enquanto aberto.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = btn.current?.getBoundingClientRect();
      if (!r) return;
      const vw = window.innerWidth, vh = window.innerHeight;
      setPos({ position: "fixed", ...(up ? { bottom: vh - r.top + 6 } : { top: r.bottom + 6 }), ...(align === "right" ? { right: Math.max(8, vw - r.right) } : { left: Math.max(8, r.left) }) });
    };
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, up, align]);

  const focusItem = (i: number) => {
    const els = list.current?.querySelectorAll<HTMLElement>("[role=menuitem]");
    if (els?.length) els[(i + els.length) % els.length].focus();
  };
  const close = (returnFocus = true) => { setOpen(false); if (returnFocus) btn.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => focusItem(0), 20);
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!wrap.current?.contains(t) && !list.current?.contains(t)) setOpen(false); };
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
        className={cn("inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-control)] text-graphite hover:text-ink hover:bg-paper-2 transition-colors min-h-8 min-w-8 pointer-coarse:min-h-11 pointer-coarse:min-w-11", triggerClassName)}
      >
        {trigger}
      </button>
      {typeof document !== "undefined" && createPortal(<AnimatePresence>
        {open && pos && (
          <motion.div style={pos}
            ref={list} id={id} role="menu" aria-label={label} onKeyDown={onListKey}
            initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: T.fast, ease: EASE }}
            className="z-[80] min-w-44 max-w-[calc(100vw-16px)] max-h-[min(70dvh,26rem)] overflow-y-auto overscroll-contain p-1 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)]"
          >
            {items.map((it) => (
              <button
                key={it.label} type="button" role="menuitem" tabIndex={-1} aria-current={it.current ? "true" : undefined}
                onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect(); }}
                className={cn("w-full text-left px-3 rounded-[8px] text-base focus:outline-none transition-colors", it.detail ? "py-1.5 min-h-11" : "h-9 pointer-coarse:h-11", it.current && "font-semibold", it.danger ? "text-alert hover:bg-alert-soft focus:bg-alert-soft" : "text-ink hover:bg-paper-2 focus:bg-paper-2")}
              >
                {it.label}
                {it.detail && <span className="block text-xs text-muted">{it.detail}</span>}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>, document.body)}
    </div>
  );
}
