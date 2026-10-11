"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { isConversationPath } from "@/lib/lead-href";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { SPRING_UI } from "@/lib/motion";
import { pushToast } from "./toast-queue";

type Action = { label: string; onClick: () => void };
type Toast = { id: number; tone: "ok" | "error" | "info"; text: string; action?: Action };
type Push = (text: string, tone?: Toast["tone"], action?: Action) => void;
const Ctx = createContext<Push>(() => {});
export const useToast = () => useContext(Ctx);

/**
 * Avisos curtos. Com "Desfazer", ficam 8 s; erros ficam 7 s. Nunca cobrem uma ação principal:
 * - celular: no alto, logo abaixo da barra do app ou, na conversa em tela cheia, abaixo do cabeçalho do lead (voltar, nome, abas). Embaixo
 *   ficam o "Próximo da fila", o campo de mensagem, as folhas e a navegação. O contêiner vai de margem a margem (centraliza com flex):
 *   com `left: 50%` + translate o aviso encolhia para meia tela;
 * - desktop: no alto, centralizado, fora do cabeçalho do painel do cliente (à direita) e longe do campo de mensagem (embaixo).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const conversation = isConversationPath(usePathname());
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const push = useCallback<Push>((text, tone = "ok", action) => {
    const id = Date.now() + Math.random();
    setItems((l) => pushToast(l, { id, tone, text, action }));
    setTimeout(() => dismiss(id), action ? 8000 : tone === "error" ? 7000 : 2800);
  }, [dismiss]);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className={`fixed z-[80] ${conversation ? "top-[calc(env(safe-area-inset-top)+6.75rem)]" : "top-[calc(env(safe-area-inset-top)+4.25rem)]"} left-[max(1rem,env(safe-area-inset-left))] right-[max(1rem,env(safe-area-inset-right))] lg:top-3 lg:left-1/2 lg:right-auto lg:-translate-x-1/2 lg:w-max lg:max-w-[28rem] flex flex-col items-center gap-2 pointer-events-none`} aria-live="polite">
        <AnimatePresence initial={false}>
          {items.map((t) => <ToastItem key={t.id} t={t} dismiss={dismiss} />)}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

/** Um aviso. Na animação de saída o aviso já não vale: sai da árvore de acessibilidade e o botão não aceita mais toque (nem um segundo "Desfazer" em cima do primeiro). */
function ToastItem({ t, dismiss }: { t: Toast; dismiss: (id: number) => void }) {
  const present = useIsPresent(); // não usePresence(): ele registra o item e o AnimatePresence esperaria um safeToRemove que nunca vem (aviso preso no DOM)
  return (
    <motion.div layout initial={{ opacity: 0, y: -10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={SPRING_UI}
      role={t.tone === "error" ? "alert" : "status"} aria-hidden={present ? undefined : true}
      className={`${present ? "pointer-events-auto" : "pointer-events-none"} pl-4 pr-2 py-2 rounded-[var(--radius-control)] text-sm shadow-[var(--shadow-pop)] flex items-center gap-3 ${t.tone === "error" ? "bg-alert text-white" : "bg-ink text-paper"}`}>
      {t.tone === "ok" && <span className="size-1.5 rounded-full bg-gold shrink-0" />}
      <span className="py-0.5">{t.text}</span>
      {t.action && (
        <button disabled={!present} className="h-7 pointer-coarse:min-h-11 px-2.5 rounded-[8px] bg-paper/10 hover:bg-paper/20 text-sm font-semibold text-gold" onClick={() => { t.action!.onClick(); dismiss(t.id); }}>
          {t.action.label}
        </button>
      )}
    </motion.div>
  );
}
