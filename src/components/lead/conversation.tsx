"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconMic } from "@/components/icons";
import { SPRING } from "@/lib/motion";

export type Msg = { id: string; direction: "in" | "out"; kind: string; body: string | null; status: string; createdAt: string; sender: string | null; fromPhone: boolean; error?: string | null; hasMedia?: boolean };

/** Foto, figurinha, áudio, vídeo ou documento vindos do WhatsApp (arquivo servido por /api/media/[id]). */
function Media({ m }: { m: Msg }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/media/${m.id}`;
  if (failed) return <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mídia"} (não foi possível carregar)</span>;
  switch (m.kind) {
    case "image": return <a href={src} target="_blank" rel="noreferrer" className="block -mx-1.5 -mt-0.5 mb-1"><img src={src} alt={m.body ?? "Foto enviada"} loading="lazy" onError={() => setFailed(true)} className="rounded-[12px] max-h-72 w-auto max-w-full object-cover bg-paper-2" /></a>;
    case "sticker": return <img src={src} alt="Figurinha" loading="lazy" onError={() => setFailed(true)} className="size-28 object-contain" />;
    case "audio": return <audio controls preload="none" src={src} onError={() => setFailed(true)} className="w-[240px] max-w-full h-10" />;
    case "video": return <video controls preload="none" src={src} onError={() => setFailed(true)} className="rounded-[12px] max-h-72 max-w-full bg-ink" />;
    case "document": return <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 underline decoration-line-strong underline-offset-2">Abrir documento{m.body ? `: ${m.body}` : ""}</a>;
    default: return null;
  }
}

const STATUS: Record<string, [string, string]> = { pending: ["enviando…", ""], sent: ["✓", ""], delivered: ["✓✓", ""], read: ["✓✓", "text-gold"], simulado: ["simulado", ""], failed: ["não enviada", "text-alert font-semibold"] };

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};
const KIND_LABEL: Record<string, string> = { image: "Foto", video: "Vídeo", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato", other: "Mensagem" };

export function Conversation({ messages }: { messages: Msg[] }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages.length]);
  return (
    <div className="flex-1 overflow-y-auto scroll-thin px-4 py-4 flex flex-col gap-1.5 bg-[radial-gradient(circle_at_1px_1px,rgb(18_18_18/0.035)_1px,transparent_0)] [background-size:18px_18px]">
      {messages.length === 0 && <p className="m-auto text-center text-muted text-[13px] max-w-[30ch]">Nenhuma mensagem ainda. A conversa aparece aqui assim que o cliente escrever.</p>}
      <AnimatePresence initial={false}>
        {messages.map((m, idx) => {
          const day = dayLabel(m.createdAt); const showDay = idx === 0 || dayLabel(messages[idx - 1].createdAt) !== day;
          const out = m.direction === "out";
          return (
            <motion.div key={m.id} layout="position" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={SPRING} className="flex flex-col">
              {showDay && <p className="self-center my-2 text-[11px] font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
              <div className={`max-w-[78%] rounded-[16px] px-3.5 py-2 text-[14px] leading-relaxed shadow-[var(--shadow-card)] ${out ? "self-end bg-[#f3ead9] rounded-br-[5px]" : "self-start bg-paper border border-line rounded-bl-[5px]"} ${m.status === "pending" ? "opacity-60" : ""}`}>
                {m.hasMedia && m.kind !== "text" ? (
                  <><Media m={m} />{m.body && m.kind !== "document" && <span className="block whitespace-pre-wrap break-words">{m.body}</span>}</>
                ) : m.kind === "audio" ? (
                  <span className="inline-flex items-center gap-2 text-graphite"><IconMic size={15} /> Áudio</span>
                ) : m.kind !== "text" && !m.body ? (
                  <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mensagem"}</span>
                ) : (
                  <>{m.kind !== "text" && <span className="text-graphite italic">{KIND_LABEL[m.kind]}: </span>}<span className="whitespace-pre-wrap break-words">{m.body}</span></>
                )}
                <span className="flex items-center justify-end gap-1 text-[10.5px] text-muted mt-1" title={m.status === "failed" && m.error ? m.error : undefined}>
                  {out && (m.fromPhone ? "pelo celular · " : m.sender ? `${m.sender.split(" ")[0]} · ` : "automática · ")}
                  {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                  {out && STATUS[m.status] && <span className={`ml-0.5 ${STATUS[m.status][1]}`} aria-label={`Status: ${m.status}`}>{STATUS[m.status][0]}</span>}
                </span>
                {out && m.status === "failed" && <span className="block text-[11.5px] text-alert mt-1">Não chegou na cliente. Copie o texto e envie de novo.</span>}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      <div ref={end} />
    </div>
  );
}
