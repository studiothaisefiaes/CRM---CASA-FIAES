"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/motion";
import { pushToast } from "./toast-queue";

type Action = { label: string; onClick: () => void };
type Toast = { id: number; tone: "ok" | "error" | "info"; text: string; action?: Action };
type Push = (text: string, tone?: Toast["tone"], action?: Action) => void;
const Ctx = createContext<Push>(() => {});
export const useToast = () => useContext(Ctx);

/** Avisos curtos. Com "Desfazer", ficam 8 s; erros ficam 7 s. No desktop aparecem no topo (não cobrem o campo de mensagem). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((text, tone = "ok", action) => {
    const id = Date.now() + Math.random();
    setItems((l) => pushToast(l, { id, tone, text, action }));
    setTimeout(() => dismiss(id), action ? 8000 : tone === "error" ? 7000 : 2800);
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed z-[80] bottom-20 left-1/2 -translate-x-1/2 lg:bottom-auto lg:top-5 lg:left-auto lg:right-6 lg:translate-x-0 flex flex-col items-center lg:items-end gap-2 pointer-events-none" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: -10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={SPRING}
              role={t.tone === "error" ? "alert" : "status"}
              className={`pointer-events-auto pl-4 pr-2 py-2 rounded-[var(--radius-control)] text-sm shadow-[var(--shadow-pop)] flex items-center gap-3 ${t.tone === "error" ? "bg-alert text-white" : "bg-ink text-paper"}`}>
              {t.tone === "ok" && <span className="size-1.5 rounded-full bg-gold shrink-0" />}
              <span className="py-0.5">{t.text}</span>
              {t.action && (
                <button className="h-7 pointer-coarse:min-h-11 px-2.5 rounded-[8px] bg-paper/10 hover:bg-paper/20 text-sm font-semibold text-gold" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
