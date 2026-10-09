"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconSend } from "@/components/icons";
import { sendMessageAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { EASE } from "@/lib/motion";

type Reply = { id: string; label: string; body: string | null };

export function Composer({ dealId, firstName, quickReplies, onOptimistic }: {
  dealId: string; firstName: string; quickReplies: Reply[]; onOptimistic: (text: string | null) => void;
}) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();
  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  const matches = useMemo(() => slash === null ? [] : quickReplies.filter((q) => q.label.toLowerCase().includes(slash) || (q.body ?? "").toLowerCase().includes(slash)).slice(0, 6), [slash, quickReplies]);

  const fill = (q: Reply) => { setText((q.body ?? "").replaceAll("{nome}", firstName)); setSel(0); requestAnimationFrame(() => ref.current?.focus()); };
  const send = () => {
    const body = text.trim(); if (!body || pending) return;
    onOptimistic(body); setText("");
    start(async () => {
      const r = await sendMessageAction(dealId, body);
      onOptimistic(null);
      if (!r.ok) { setText(body); toast(r.error, "error"); }
    });
  };

  return (
    <div className="relative border-t border-line bg-paper p-3">
      <AnimatePresence>
        {matches.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16, ease: EASE }}
            className="absolute left-3 right-3 bottom-full mb-2 bg-paper border border-line rounded-[14px] shadow-[var(--shadow-pop)] overflow-hidden" role="listbox" aria-label="Respostas prontas">
            {matches.map((q, i) => (
              <li key={q.id} role="option" aria-selected={i === sel}>
                <button type="button" onMouseEnter={() => setSel(i)} onClick={() => fill(q)} className={`w-full text-left px-3.5 py-2.5 ${i === sel ? "bg-paper-2" : ""}`}>
                  <span className="text-[12px] font-semibold text-gold-ink">/{q.label}</span>
                  <span className="block text-[13px] text-graphite truncate">{q.body}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-2">
        <textarea ref={ref} value={text} rows={1} placeholder="Responder pelo WhatsApp…  ( / para respostas prontas )" aria-label="Mensagem"
          onChange={(e) => { setText(e.target.value); setSel(0); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); fill(matches[sel]); return; }
              if (e.key === "Escape") { setText(""); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          className="flex-1 resize-none bg-paper-2 rounded-[12px] px-3.5 py-2.5 text-[14px] leading-relaxed outline-none focus:bg-paper focus:shadow-[0_0_0_1px_var(--color-ink),0_0_0_4px_rgb(184_134_63/0.2)] transition-shadow max-h-40" />
        <motion.button type="button" onClick={send} disabled={!text.trim() || pending} whileTap={{ scale: 0.92 }} aria-label="Enviar"
          className="size-11 shrink-0 grid place-items-center rounded-[12px] bg-ink text-paper disabled:opacity-35 transition-opacity">
          {pending ? <span className="size-4 rounded-full border-2 border-paper border-r-transparent animate-spin" /> : <IconSend size={18} />}
        </motion.button>
      </div>
      <p className="text-[11px] text-muted mt-1.5 px-1">Enter envia · Shift+Enter quebra linha</p>
    </div>
  );
}
