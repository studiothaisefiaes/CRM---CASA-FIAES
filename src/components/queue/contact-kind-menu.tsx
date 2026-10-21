"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useTransition, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { setContactKindAction, unarchiveConversationAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { CONTACT_KINDS, KIND_HINT, KIND_LABEL, type ContactKind } from "@/lib/contact-kind";
import { T, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

const DONE: Record<ContactKind, (name: string) => string> = {
  cliente: (n) => `${n} voltou a ser cliente`,
  equipe: (n) => `${n} agora é Equipe: fica na lista Equipe`,
  fornecedor: (n) => `${n} agora é Fornecedor: conversa resolvida`,
  spam: (n) => `${n} agora é Spam e saiu da lista`,
};

/**
 * "Marcar como…": grava o tipo, avisa com Desfazer (volta ao tipo de antes) e chama `onDone` depois de cada mudança
 * (`undone`: foi o Desfazer; quem estava com a conversa fechada pelo Spam a abre de novo).
 */
export function useMarkContact(onDone: (kind: ContactKind, undone: boolean) => void) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  const mark = useCallback((contactId: string, name: string, kind: ContactKind) => {
    start(async () => {
      const r = await setContactKindAction(contactId, kind);
      if (!r.ok) { toast(r.error, "error"); return; }
      if (!r.data?.changed) { toast(`Já está como ${KIND_LABEL[kind]}`, "info"); return; }
      const before = r.data.before;
      done.current(kind, false);
      toast(DONE[kind](name), "ok", {
        label: "Desfazer",
        onClick: () => {
          void setContactKindAction(contactId, before).then(async (u) => {
            if (!u.ok) { toast(u.error, "error"); return; }
            if (!u.data?.changed) { toast("Essa conversa já tinha voltado", "info"); return; } // alguém já desfez por outro caminho
            // Fornecedor tinha resolvido a conversa: o Desfazer a reabre.
            if (r.data?.resolved && r.data.dealId) await unarchiveConversationAction(r.data.dealId);
            done.current(before, true); toast(`${name} voltou a ser ${KIND_LABEL[before]}`);
          });
        },
      });
    });
  }, [toast]);
  return { mark, pending };
}

/**
 * O menu do botão direito (e do toque longo no celular) na linha da Fila: "Marcar como…" Cliente, Equipe, Fornecedor, Spam.
 * Abre onde tocou (sem sair da tela), setas navegam, Esc ou tocar fora fecha.
 */
export function ContactKindPopover({ at, name, current, onPick, onClose }: {
  at: { x: number; y: number } | null; name: string; current: ContactKind; onPick: (k: ContactKind) => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Abre no ponto tocado, mas sempre inteiro na tela (perto da borda, encosta para dentro). Mexe só no estilo: nada de render a mais.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!at || !el) return;
    el.style.left = `${Math.max(8, Math.min(at.x, window.innerWidth - el.offsetWidth - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(at.y, window.innerHeight - el.offsetHeight - 8))}px`;
  }, [at]);
  useEffect(() => {
    if (!at) return;
    const t = setTimeout(() => ref.current?.querySelector<HTMLElement>("[role=menuitemradio]")?.focus(), 20);
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [at, onClose]);
  const onKey = (e: KeyboardEvent) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); els[(n + els.length) % els.length]?.focus(); };
    if (e.key === "ArrowDown") go(i + 1); else if (e.key === "ArrowUp") go(i - 1); else if (e.key === "Home") go(0); else if (e.key === "End") go(-1);
    else if (e.key === "Tab") onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {at && (
        <motion.div ref={ref} role="menu" aria-label={`Marcar ${name} como…`} onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}
          style={{ position: "fixed", left: at.x, top: at.y }}
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.fast, ease: EASE }}
          className="z-[80] w-60 max-w-[calc(100vw-16px)] p-1 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)]">
          <p aria-hidden className="px-3 pt-1.5 pb-1 text-xs font-semibold text-muted">Marcar como…</p>
          {CONTACT_KINDS.map((k) => (
            <button key={k} type="button" role="menuitemradio" aria-checked={k === current}
              onClick={() => { onClose(); if (k !== current) onPick(k); }}
              className={cn("w-full text-left px-3 py-1.5 min-h-11 rounded-[8px] text-base focus:outline-none transition-colors hover:bg-paper-2 focus:bg-paper-2",
                k === current && "font-semibold", k === "spam" && k !== current && "text-alert hover:bg-alert-soft focus:bg-alert-soft")}>
              <span className="flex items-center justify-between gap-2">{KIND_LABEL[k]}{k === current && <span className="text-xs font-normal text-muted">atual</span>}</span>
              <span className="block text-xs font-normal text-muted">{KIND_HINT[k]}</span>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
