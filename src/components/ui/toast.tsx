"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SPRING } from "@/lib/motion";

type Toast = { id: number; tone: "ok" | "error" | "info"; text: string };
const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setItems((l) => [...l.slice(-2), { id, tone, text }]);
    setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), tone === "error" ? 6000 : 2800);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="fixed z-[80] bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 pointer-events-none" aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: 16, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={SPRING}
              className={`pointer-events-auto px-4 py-2.5 rounded-[12px] text-[13.5px] shadow-[var(--shadow-pop)] flex items-center gap-2 ${t.tone === "error" ? "bg-alert text-white" : "bg-ink text-paper"}`}>
              {t.tone === "ok" && <span className="size-1.5 rounded-full bg-gold" />}{t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
