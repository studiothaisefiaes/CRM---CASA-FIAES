"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EMOJI_CATEGORIES, pushRecent, searchEmojis } from "@/lib/emojis";
import { SPRING_UI } from "@/lib/motion";
import { cn } from "@/lib/cn";

const RECENT_KEY = "crm-emojis-recentes";
const readRecent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch { return []; } };

/**
 * Seletor de emojis da conversa, no jeito do iPhone: abas por categoria (com "Recentes" quando houver), busca em português e grade
 * grande para tocar. Escolher não fecha: dá para pôr vários seguidos; fecha com Esc, tocando fora ou no botão.
 */
export function EmojiButton({ onPick, disabled }: { onPick: (emoji: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("rostos");
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey, true); };
  }, [open]);

  const pick = (e: string) => {
    onPick(e);
    const next = pushRecent(readRecent(), e); setRecent(next);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* sem armazenamento: só não lembra */ }
  };
  const tabs = [...(recent.length ? [{ key: "recentes", label: "Recentes", icon: "🕘" }] : []), ...EMOJI_CATEGORIES.map(({ key, label, icon }) => ({ key, label, icon }))];
  const list = q.trim() ? searchEmojis(q) : tab === "recentes" ? recent : (EMOJI_CATEGORIES.find((c) => c.key === tab)?.items.map(([e]) => e) ?? []);
  const title = q.trim() ? `Resultados para “${q.trim()}”` : tabs.find((t) => t.key === tab)?.label;

  return (
    <div className="relative">
      <button ref={button} type="button" disabled={disabled} onClick={() => {
          if (!open) { const r = readRecent(); setRecent(r); setTab(r.length ? "recentes" : "rostos"); setQ(""); }
          setOpen(!open);
        }} aria-label="Emojis" aria-expanded={open} aria-haspopup="dialog" title="Emojis"
        className={cn("grid size-11 place-items-center rounded-[var(--radius-control)] text-[22px] leading-none transition-colors disabled:opacity-40", open ? "bg-paper-3" : "hover:bg-paper-2")}>
        <span aria-hidden className={cn("transition-transform", open && "scale-110")}>😊</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div ref={box} role="dialog" aria-label="Emojis" initial={{ opacity: 0, scale: 0.92, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 6 }} transition={SPRING_UI}
            style={{ transformOrigin: "bottom left" }}
            className="absolute bottom-[calc(100%+10px)] left-0 z-40 w-[352px] max-sm:fixed max-sm:inset-x-3 max-sm:bottom-[calc(env(safe-area-inset-bottom)+84px)] max-sm:w-auto overflow-hidden rounded-[18px] border border-line bg-paper/95 shadow-[0_20px_50px_-12px_rgb(18_18_18/0.35)] backdrop-blur-xl">
            <div className="p-2.5 pb-1.5">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar emoji" aria-label="Buscar emoji" autoFocus
                className="h-9 w-full rounded-[10px] bg-paper-3/70 px-3 text-[16px] outline-none placeholder:text-muted focus:bg-paper-3 lg:text-sm" />
            </div>
            <p className="px-3.5 pb-1 text-xs font-semibold text-graphite">{title}</p>
            <div className="grid h-[232px] grid-cols-8 content-start gap-0.5 overflow-y-auto px-2 pb-2 scroll-thin" role="listbox" aria-label={title}>
              {list.map((e) => (
                <button key={e} type="button" role="option" aria-selected={false} aria-label={e} onClick={() => pick(e)}
                  className="grid aspect-square place-items-center rounded-[10px] text-[26px] leading-none transition-transform hover:bg-paper-3/70 active:scale-90">{e}</button>
              ))}
              {list.length === 0 && <p className="col-span-8 py-10 text-center text-sm text-muted">{q.trim() ? "Nenhum emoji com esse nome." : "Os emojis que você usar aparecem aqui."}</p>}
            </div>
            {!q.trim() && (
              <div className="flex border-t border-line/70 bg-paper-2/60 px-1.5 py-1" role="tablist" aria-label="Categorias de emoji">
                {tabs.map((t) => (
                  <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} aria-label={t.label} title={t.label} onClick={() => setTab(t.key)}
                    className={cn("relative grid h-9 flex-1 place-items-center rounded-[10px] text-lg leading-none transition-opacity", tab === t.key ? "opacity-100" : "opacity-45 hover:opacity-80")}>
                    {tab === t.key && <motion.span layoutId="emoji-tab" transition={SPRING_UI} className="absolute inset-0.5 rounded-[9px] bg-paper shadow-[var(--shadow-card)]" />}
                    <span className="relative">{t.icon}</span>
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
