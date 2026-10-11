"use client";
import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconMic, IconReply } from "@/components/icons";
import { IconButton } from "@/components/ui/icon-button";
import { T, EASE, SPRING_UI } from "@/lib/motion";

export type Msg = { id: string; externalId?: string | null; direction: "in" | "out"; kind: string; body: string | null; status: string; createdAt: string; sender: string | null; fromPhone: boolean; error?: string | null; hasMedia?: boolean; quotedBody?: string | null; edited?: boolean; deleted?: boolean;
  /** Quando a retenção apagou o arquivo da mídia (ISO): a tela mostra \"Mídia expirada\". */ purgedAt?: string };

/** Foto, figurinha, áudio, vídeo ou documento vindos do WhatsApp (arquivo servido por /api/media/[id]). */
function Media({ m }: { m: Msg }) {
  const [failed, setFailed] = useState(false);
  const src = `/api/media/${m.id}`;
  if (m.purgedAt) return <span data-testid="midia-expirada" className="text-graphite italic">Mídia expirada · apagada em {new Date(m.purgedAt).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" })}</span>;
  if (failed) return <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mídia"} (não foi possível carregar)</span>;
  switch (m.kind) {
    case "image": return <a href={src} target="_blank" rel="noreferrer" className="block -mx-1.5 -mt-0.5 mb-1"><img src={src} alt={m.body ?? "Foto enviada"} loading="lazy" onError={() => setFailed(true)} className="rounded-[var(--radius-control)] max-h-72 w-auto max-w-full object-cover bg-paper-2" /></a>;
    case "sticker": return <img src={src} alt="Figurinha" loading="lazy" onError={() => setFailed(true)} className="size-28 object-contain" />;
    case "audio": return <audio controls preload="none" src={src} onError={() => setFailed(true)} className="w-[240px] max-w-full h-10" />;
    case "video": return <video controls preload="none" src={src} onError={() => setFailed(true)} className="rounded-[var(--radius-control)] max-h-72 max-w-full bg-ink" />;
    case "document": return <a href={src} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 underline decoration-line-strong underline-offset-2">Abrir documento{m.body ? `: ${m.body}` : ""}</a>;
    default: return null;
  }
}

const STATUS: Record<string, [string, string]> = { pending: ["enviando…", ""], sent: ["✓", ""], delivered: ["✓✓", ""], read: ["✓✓", "text-gold-ink"], simulado: ["simulado", ""], failed: ["não enviada", "text-alert font-semibold"] };

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1);
  if (d.toDateString() === t.toDateString()) return "Hoje";
  if (d.toDateString() === y.toDateString()) return "Ontem";
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
};
const KIND_LABEL: Record<string, string> = { image: "Foto", video: "Vídeo", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem sem prévia (veja no celular)" };

/** Texto curto da mensagem para a faixa "Respondendo a". */
export const quotePreview = (m: Msg) => (m.body?.trim() || KIND_LABEL[m.kind] || "Mensagem").slice(0, 300);

/** Os campos que mudam o que o balão mostra. A lista recria os objetos a cada carga; só re-renderiza quem mudou de verdade. */
const sameMsg = (a: Msg, b: Msg) =>
  a === b || (a.id === b.id && a.status === b.status && a.body === b.body && a.kind === b.kind && a.error === b.error && a.quotedBody === b.quotedBody && a.edited === b.edited
    && a.deleted === b.deleted && a.purgedAt === b.purgedAt && a.hasMedia === b.hasMedia && a.externalId === b.externalId && a.sender === b.sender && a.fromPhone === b.fromPhone && a.direction === b.direction && a.createdAt === b.createdAt);

type BubbleProps = { m: Msg; /** Rótulo do dia, quando este balão abre um dia novo. */ day: string | null; onReply?: (m: Msg) => void; /** Entra com animação (mensagem que chegou depois da abertura). */ animateIn: boolean };

/** Dois conjuntos de props rendem o mesmo balão? (a lista recria os objetos a cada carga; o `memo` compara pelo conteúdo, não pela identidade) */
export const bubblePropsEqual = (a: BubbleProps, b: BubbleProps) => a.day === b.day && a.onReply === b.onReply && a.animateIn === b.animateIn && sameMsg(a.m, b.m);

/** Um balão. `memo` por conteúdo: um evento novo não re-renderiza a conversa inteira. */
export const Bubble = memo(function Bubble({ m, day, onReply, animateIn }: BubbleProps) {
  const out = m.direction === "out";
  return (
    <motion.div initial={animateIn ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI} className="flex flex-col">
      {day && <p className="self-center my-2 text-xs font-medium text-muted bg-paper border border-line rounded-full px-2.5 py-0.5 first-letter:uppercase">{day}</p>}
      <div className={`group flex items-center gap-1 ${out ? "flex-row-reverse self-end" : "self-start"} max-w-full`}>
        <div className={`min-w-0 max-w-[78%] rounded-[var(--radius-card)] px-3.5 py-2 text-base leading-relaxed shadow-[var(--shadow-card)] ${out ? "bg-[#f3ead9] rounded-br-[5px]" : "bg-paper border border-line rounded-bl-[5px]"} ${m.status === "pending" ? "opacity-60" : ""}`}>
          {m.quotedBody && (
            <span className={`block mb-1.5 -mx-1 px-2.5 py-1.5 rounded-[var(--radius-control)] border-l-2 border-gold/70 text-sm text-graphite line-clamp-3 ${out ? "bg-paper/60" : "bg-paper-2"}`}>{m.quotedBody}</span>
          )}
          {m.deleted && <span className="block text-xs font-medium text-alert/80 mb-0.5">Apagada pela cliente no WhatsApp</span>}
          <span className={m.deleted ? "block line-through decoration-alert/50 opacity-60" : "contents"}>
            {m.hasMedia && m.kind !== "text" ? (
              <><Media m={m} />{m.body && m.kind !== "document" && <span className="block whitespace-pre-wrap break-words">{m.body}</span>}</>
            ) : m.kind === "audio" ? (
              <span className="inline-flex items-center gap-2 text-graphite"><IconMic size={15} /> Áudio</span>
            ) : m.kind !== "text" && !m.body ? (
              <span className="text-graphite italic">{KIND_LABEL[m.kind] ?? "Mensagem"}</span>
            ) : (
              <>{m.kind !== "text" && <span className="text-graphite italic">{KIND_LABEL[m.kind]}: </span>}<span className="whitespace-pre-wrap break-words">{m.body}</span></>
            )}
          </span>
          <span className="flex items-center justify-end gap-1 text-[10.5px] text-muted mt-1" title={m.status === "failed" && m.error ? m.error : undefined}>
            {m.edited && "editada · "}
            {out && (m.fromPhone ? "pelo celular · " : m.sender ? `${m.sender.split(" ")[0]} · ` : "automática · ")}
            {new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
            {out && STATUS[m.status] && <span className={`ml-0.5 ${STATUS[m.status][1]}`} aria-label={`Status: ${m.status}`}>{STATUS[m.status][0]}</span>}
          </span>
          {out && m.status === "failed" && <span className="block text-xs text-alert mt-1">Não chegou na cliente. Copie o texto e envie de novo.</span>}
        </div>
        {onReply && m.id !== "optimistic" && m.externalId && m.status !== "pending" && m.status !== "failed" && !m.deleted && (
          <IconButton label="Responder" onClick={() => onReply(m)}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-70 transition-opacity"><IconReply size={16} /></IconButton>
        )}
      </div>
    </motion.div>
  );
}, bubblePropsEqual);

/** Os balões com o rótulo do dia onde o dia muda. */
const withDays = (messages: Msg[]) => messages.map((m, i) => {
  const day = dayLabel(m.createdAt);
  return { m, day: i === 0 || dayLabel(messages[i - 1].createdAt) !== day ? day : null };
});

const BOTTOM_SLACK = 48; // quanto de folga ainda conta como "no fim"
export const WRAP = "bg-[radial-gradient(circle_at_1px_1px,rgb(18_18_18/0.035)_1px,transparent_0)] [background-size:18px_18px]";

/**
 * A conversa. Abre no fim (sem rolagem animada). Mensagem nova: se a pessoa está no fim, a conversa desce junto;
 * se ela rolou para cima, a leitura não se mexe e aparece o aviso "N nova(s) mensagem(ns)".
 * Só o que a própria atendente envia desce sozinho (o balão provisório, ou `forceEndKey` mudando quando o envio é de mídia, sem balão provisório);
 * saída por outro canal (celular da Casa, automação) segue a regra do aviso.
 * `visible` é falso quando a conversa está escondida por uma aba (celular): ao reaparecer, volta ao fim se estava no fim, ou à posição em que ficou.
 */
export function Conversation({ messages, onReply, label = "Mensagens", forceEndKey = 0, visible = true }: { messages: Msg[]; onReply?: (m: Msg) => void; label?: string; forceEndKey?: number; visible?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const lastTop = useRef(0); // onde a leitura estava (para voltar a ela depois de uma aba)
  const stuck = useRef(true); // a pessoa está no fim: acompanha o que crescer (mensagem, foto que carregou, teclado que abriu)
  const seen = useRef<{ lastId: string | null; optimistic: boolean } | null>(null);
  const [unseen, setUnseen] = useState(0);
  // Quem já estava na tela ao abrir não anima; só o que chega depois.
  const [initialIds] = useState(() => new Set(messages.map((m) => m.id)));

  const toEnd = useCallback(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    stuck.current = true;
  }, []);

  useLayoutEffect(() => {
    const real = messages.filter((m) => m.id !== "optimistic");
    const lastId = real.at(-1)?.id ?? null;
    const optimistic = messages.length > real.length;
    const prev = seen.current;
    seen.current = { lastId, optimistic };
    if (!prev) { toEnd(); return; } // abertura: direto no fim, antes da pintura
    const at = prev.lastId ? real.findIndex((m) => m.id === prev.lastId) : -1;
    const fresh = at >= 0 ? real.slice(at + 1) : prev.lastId === lastId ? [] : real; // lista trocada por inteiro: tudo conta como novo
    const mine = optimistic && !prev.optimistic; // o balão provisório da própria atendente
    if (mine || (fresh.length && stuck.current)) { toEnd(); setUnseen(0); } // eslint-disable-line react-hooks/set-state-in-effect -- o aviso zera junto com a rolagem
    else if (fresh.length) setUnseen((n) => n + fresh.length);
  }, [messages, toEnd]);

  // Envio de mídia (sem balão provisório): a própria atendente quer ver o que mandou.
  const endKey = useRef(forceEndKey);
  useLayoutEffect(() => {
    if (endKey.current === forceEndKey) return;
    endKey.current = forceEndKey;
    toEnd(); setUnseen(0); // eslint-disable-line react-hooks/set-state-in-effect -- zera o aviso junto com a rolagem
  }, [forceEndKey, toEnd]);

  // Aba que reexibe a conversa (o navegador perde a rolagem de um elemento escondido).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!visible || !el) return;
    if (stuck.current) toEnd(); else el.scrollTop = lastTop.current;
  }, [visible, toEnd]);

  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (stuck.current && scroller.current?.clientHeight) toEnd(); });
    if (inner.current) ro.observe(inner.current);
    if (scroller.current) ro.observe(scroller.current);
    return () => ro.disconnect();
  }, [toEnd]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientHeight) return; // escondida por uma aba: o navegador zera a rolagem, e isso não é a pessoa lendo
    lastTop.current = el.scrollTop;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK;
    stuck.current = atEnd;
    if (atEnd) setUnseen((n) => (n ? 0 : n));
  };

  const rows = withDays(messages);
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div ref={scroller} onScroll={onScroll} role="log" aria-label={label} tabIndex={0}
        className={`flex-1 min-h-0 overflow-y-auto overscroll-contain scroll-thin px-4 py-4 outline-offset-[-2px] ${WRAP}`}>
        <div ref={inner} className="flex flex-col gap-1.5 min-h-full">
          {messages.length === 0 && <p className="m-auto text-center text-muted text-sm max-w-[30ch]">Nenhuma mensagem ainda. A conversa aparece aqui assim que o cliente escrever.</p>}
          {rows.map(({ m, day }) => (
            <Bubble key={m.id} m={m} day={day} onReply={onReply} animateIn={!initialIds.has(m.id) && (m.direction === "in" || m.id === "optimistic")} />
          ))}
        </div>
      </div>
      <AnimatePresence>
        {unseen > 0 && (
          <motion.button type="button" key="novas" onClick={() => { toEnd(); setUnseen(0); }}
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: T.base, ease: EASE }}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 min-h-11 px-4 rounded-full bg-ink text-paper text-sm font-semibold shadow-[var(--shadow-pop)] inline-flex items-center gap-2">
            {unseen === 1 ? "1 nova mensagem" : `${unseen} novas mensagens`} <span aria-hidden>↓</span>
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
