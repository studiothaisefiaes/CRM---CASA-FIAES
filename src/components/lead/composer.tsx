"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconSend } from "@/components/icons";
import { sendMessageAction } from "@/app/(app)/funil/actions";
import { useToast } from "@/components/ui/toast";
import { EASE } from "@/lib/motion";

type Reply = { id: string; label: string; body: string | null };

export function Composer({ dealId, firstName, quickReplies, onOptimistic, onSent, slaSeconds }: {
  dealId: string; firstName: string; quickReplies: Reply[]; onOptimistic: (text: string | null) => void; onSent?: () => void; slaSeconds?: number | null;
}) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const justFilled = useRef(false);
  const toast = useToast();
  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  const matches = useMemo(() => slash === null ? [] : quickReplies.filter((q) => q.label.toLowerCase().includes(slash) || (q.body ?? "").toLowerCase().includes(slash)).slice(0, 6), [slash, quickReplies]);

  const render = (b: string | null) => (b ?? "").replaceAll("{nome}", firstName || "").replace(/,\s*!/g, "!").replace(/\s{2,}/g, " ");
  const fill = (q: Reply) => { setText(render(q.body)); setSel(0); justFilled.current = true; setTimeout(() => { justFilled.current = false; }, 450); requestAnimationFrame(() => ref.current?.focus()); };
  const send = () => {
    const body = text.trim(); if (!body || pending) return;
    // Evita mandar sem revisar logo após preencher uma resposta pronta.
    if (justFilled.current) return;
    onOptimistic(body); setText("");
    start(async () => {
      const r = await sendMessageAction(dealId, body);
      onOptimistic(null);
      if (!r.ok) { setText(body); toast(r.error, "error"); return; }
      const w = r.data?.waitedSeconds;
      if (w != null) toast(`Respondido em ${w < 60 ? `${w} s` : `${Math.floor(w / 60)} min`}${slaSeconds && w <= slaSeconds ? " ✓ dentro da meta" : ""}`, "ok");
      onSent?.();
    });
  };

  return (
    <div className="relative border-t border-line bg-paper p-3">
      <AnimatePresence>
        {matches.length > 0 && (
          <motion.ul initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16, ease: EASE }}
            className="absolute left-3 right-3 bottom-full mb-2 bg-paper border border-line rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] overflow-hidden" role="listbox" aria-label="Respostas prontas">
            {matches.map((q, i) => (
              <li key={q.id} role="option" aria-selected={i === sel}>
                <button type="button" onMouseEnter={() => setSel(i)} onClick={() => fill(q)} className={`w-full text-left px-3.5 py-2.5 ${i === sel ? "bg-paper-2" : ""}`}>
                  <span className="text-xs font-semibold text-gold-ink">/{q.label}</span>
                  <span className="block text-sm text-graphite truncate">{render(q.body)}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      <div className="flex items-end gap-2">
        <textarea ref={ref} value={text} rows={1} placeholder="Mensagem…" aria-label="Mensagem"
          onChange={(e) => { setText(e.target.value); setSel(0); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
          onKeyDown={(e) => {
            if (matches.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); fill(matches[sel]); return; }
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setText(""); return; }
            }
            if (e.key === "Escape" && text.trim()) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); (e.target as HTMLTextAreaElement).blur(); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          className="flex-1 resize-none bg-paper-2 rounded-[var(--radius-control)] px-3.5 py-2.5 text-[16px] lg:text-base leading-relaxed outline-none focus:bg-paper focus:shadow-[0_0_0_1px_var(--color-ink),0_0_0_4px_rgb(184_134_63/0.2)] transition-shadow max-h-40" />
        <motion.button type="button" onClick={send} disabled={!text.trim() || pending} whileTap={{ scale: 0.92 }} aria-label="Enviar"
          className="size-11 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-ink text-paper disabled:opacity-35 transition-opacity">
          {pending ? <span className="size-4 rounded-full border-2 border-paper border-r-transparent animate-spin" /> : <IconSend size={18} />}
        </motion.button>
      </div>
      <p className="text-xs text-muted mt-1.5 px-1 hidden sm:block"><b className="text-graphite">/</b> respostas prontas · Enter envia · Shift+Enter quebra linha</p>
    </div>
  );
}
