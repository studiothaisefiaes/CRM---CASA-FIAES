"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IconClose, IconMic, IconPaperclip, IconReply, IconSend, IconStop, IconTrash } from "@/components/icons";
import { sendMediaAction, sendMessageAction } from "@/app/(app)/funil/actions";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { EASE } from "@/lib/motion";

type Reply = { id: string; label: string; body: string | null };
export type QuoteTarget = { id: string; text: string };
type Attachment = { file: File; url: string; kind: "image" | "audio" | "file"; recorded?: boolean };

const MAX_BYTES = 16 * 1024 * 1024;
/** Chrome/Firefox gravam webm/ogg; Safari/iOS grava mp4. Só oferece o gravador se o navegador sabe algum destes. */
const RECORD_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
const pickRecordType = () => (typeof MediaRecorder === "undefined" ? null : RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);
const EXT: Record<string, string> = { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a" };
const noSubscribe = () => () => {};
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const kindOf = (f: File): Attachment["kind"] => (f.type.startsWith("image/") ? "image" : f.type.startsWith("audio/") ? "audio" : "file");

export function Composer({ dealId, firstName, quickReplies, onOptimistic, onSent, slaSeconds, replyTo, onClearReply }: {
  dealId: string; firstName: string; quickReplies: Reply[]; onOptimistic: (text: string | null) => void; onSent?: () => void; slaSeconds?: number | null;
  replyTo?: QuoteTarget | null; onClearReply?: () => void;
}) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(0);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [recording, setRecording] = useState<{ seconds: number } | null>(null);
  const canRecord = useSyncExternalStore(noSubscribe, () => !!navigator.mediaDevices?.getUserMedia && !!pickRecordType(), () => false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<{ rec: MediaRecorder; stream: MediaStream; chunks: Blob[]; cancelled: boolean; timer: ReturnType<typeof setInterval> } | null>(null);
  const justFilled = useRef(false);
  const toast = useToast();
  const slash = text.startsWith("/") && !text.includes("\n") ? text.slice(1).toLowerCase() : null;
  const matches = useMemo(() => slash === null ? [] : quickReplies.filter((q) => q.label.toLowerCase().includes(slash) || (q.body ?? "").toLowerCase().includes(slash)).slice(0, 6), [slash, quickReplies]);

  // Liberta o microfone e as URLs de prévia ao sair da conversa.
  useEffect(() => () => { const r = recorder.current; if (r) { r.cancelled = true; clearInterval(r.timer); if (r.rec.state !== "inactive") r.rec.stop(); r.stream.getTracks().forEach((t) => t.stop()); } }, []);
  useEffect(() => () => { if (attachment) URL.revokeObjectURL(attachment.url); }, [attachment]);
  useEffect(() => { if (replyTo) ref.current?.focus(); }, [replyTo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const render = (b: string | null) => (b ?? "").replaceAll("{nome}", firstName || "").replace(/,\s*!/g, "!").replace(/\s{2,}/g, " ");
  const fill = (q: Reply) => { setText(render(q.body)); setSel(0); justFilled.current = true; setTimeout(() => { justFilled.current = false; }, 450); requestAnimationFrame(() => ref.current?.focus()); };

  const attach = (file: File | undefined, recorded = false) => {
    if (!file) return;
    if (file.size > MAX_BYTES) { toast("O arquivo passa de 16 MB. Escolha um menor.", "error"); return; }
    if (!file.size) { toast("O arquivo está vazio.", "error"); return; }
    setAttachment({ file, url: URL.createObjectURL(file), kind: kindOf(file), recorded });
  };

  const startRecording = async () => {
    const type = pickRecordType(); if (!type || recorder.current) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: type });
      const chunks: Blob[] = [];
      const live = stream;
      let seconds = 0;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      // O timer e o registro do gravador só existem depois que o start() deu certo: se ele lançar, nada fica preso.
      rec.onstop = () => {
        const r = recorder.current; recorder.current = null;
        clearInterval(r?.timer); live.getTracks().forEach((t) => t.stop()); setRecording(null);
        if (!r || r.cancelled || !chunks.length) return;
        const base = type.split(";")[0];
        attach(new File(chunks, `gravacao.${EXT[base] ?? "webm"}`, { type: base }), true);
      };
      rec.start();
      const timer = setInterval(() => { seconds += 1; setRecording({ seconds }); if (seconds >= 15 * 60) rec.stop(); }, 1000);
      recorder.current = { rec, stream: live, chunks, cancelled: false, timer };
      setRecording({ seconds: 0 });
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      const name = e instanceof DOMException || e instanceof Error ? e.name : "";
      toast(name === "NotAllowedError" ? "Libere o microfone nas permissões do navegador." : name === "NotFoundError" ? "Nenhum microfone encontrado." : "Não deu para gravar neste navegador.", "error");
    }
  };
  const stopRecording = () => recorder.current?.rec.stop();
  const cancelRecording = () => { const r = recorder.current; if (!r) return; r.cancelled = true; r.rec.stop(); };

  const isAudio = attachment?.kind === "audio";
  const canSend = !!(text.trim() || attachment) && !recording;
  const send = () => {
    if (!canSend || pending) return;
    // Evita mandar sem revisar logo após preencher uma resposta pronta.
    if (justFilled.current) return;
    const att = attachment;
    // Áudio vai sem legenda (o WhatsApp não aceita); o texto digitado fica no campo.
    const body = att?.kind === "audio" ? "" : text.trim(); const quote = replyTo ?? null;
    const done = (r: { ok: true; data?: { waitedSeconds: number | null } } | { ok: false; error: string }, restore: () => void) => {
      if (!r.ok) { restore(); toast(r.error, "error"); return; }
      const w = r.data?.waitedSeconds;
      if (w != null) toast(`Respondido em ${w < 60 ? `${w} s` : `${Math.floor(w / 60)} min`}${slaSeconds && w <= slaSeconds ? " ✓ dentro da meta" : ""}`, "ok");
      onSent?.();
    };
    if (att) {
      setAttachment(null); if (att.kind !== "audio") setText(""); onClearReply?.();
      start(async () => {
        const form = new FormData();
        form.set("dealId", dealId); form.set("file", att.file); form.set("caption", body);
        if (quote) form.set("quoteMessageId", quote.id);
        done(await sendMediaAction(form), () => { setAttachment({ ...att, url: URL.createObjectURL(att.file) }); if (att.kind !== "audio") setText(body); });
      });
      return;
    }
    onOptimistic(body); setText(""); onClearReply?.();
    start(async () => {
      const r = await sendMessageAction(dealId, body, quote?.id ?? null);
      onOptimistic(null);
      done(r, () => setText(body));
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

      <AnimatePresence initial={false}>
        {replyTo && (
          <motion.div key="reply" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16, ease: EASE }}
            className="mb-2 flex items-center gap-2 rounded-[var(--radius-control)] bg-paper-2 border-l-2 border-gold/70 pl-3 pr-1 py-1">
            <IconReply size={15} className="shrink-0 text-gold-ink" />
            <p className="min-w-0 flex-1 text-sm text-graphite truncate"><span className="font-semibold text-ink">Respondendo a: </span>{replyTo.text}</p>
            <IconButton label="Cancelar resposta" onClick={onClearReply}><IconClose size={16} /></IconButton>
          </motion.div>
        )}
        {attachment && (
          <motion.div key="attachment" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.16, ease: EASE }}
            className="mb-2 flex items-center gap-3 rounded-[var(--radius-control)] border border-line bg-paper-2 p-2" role="group" aria-label="Arquivo para enviar">
            {attachment.kind === "image"
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={attachment.url} alt="Prévia da foto" className="size-16 shrink-0 rounded-[8px] object-cover bg-paper" />
              : attachment.kind === "audio"
                ? <audio controls src={attachment.url} aria-label="Prévia do áudio" className="h-10 min-w-0 flex-1" />
                : <span className="size-16 shrink-0 grid place-items-center rounded-[8px] bg-paper text-xs font-semibold text-gold-ink">{attachment.file.name.split(".").pop()?.slice(0, 4).toUpperCase() ?? "ARQ"}</span>}
            {attachment.kind !== "audio" && (
              <p className="min-w-0 flex-1 text-sm"><span className="block truncate font-medium">{attachment.file.name}</span><span className="text-muted">{size(attachment.file.size)} · escreva uma legenda se quiser</span></p>
            )}
            <IconButton label="Remover arquivo" size="lg" onClick={() => setAttachment(null)}><IconTrash size={16} /></IconButton>
          </motion.div>
        )}
      </AnimatePresence>

      {recording ? (
        <div className="flex items-center gap-2">
          <span role="status" className="sr-only">Gravando áudio</span>
          <IconButton label="Descartar gravação" size="lg" onClick={cancelRecording}><IconTrash size={18} /></IconButton>
          <p className="flex-1 flex items-center gap-2 h-11 px-3.5 rounded-[var(--radius-control)] bg-paper-2 text-base">
            <span className="size-2.5 rounded-full bg-alert animate-pulse" aria-hidden />Gravando <span aria-hidden className="tabular-nums text-graphite">{clock(recording.seconds)}</span>
          </p>
          <motion.button type="button" onClick={stopRecording} whileTap={{ scale: 0.92 }} aria-label="Parar e revisar áudio"
            className="size-11 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-ink text-paper"><IconStop size={18} /></motion.button>
        </div>
      ) : (
        <div className="flex items-end gap-1.5">
          <input ref={fileInput} type="file" hidden accept="image/*,application/pdf,audio/*" aria-label="Escolher arquivo" data-testid="anexo"
            onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
          <IconButton label="Anexar foto, PDF ou áudio" size="lg" onClick={() => fileInput.current?.click()} className="h-11"><IconPaperclip size={20} /></IconButton>
          <textarea ref={ref} value={text} rows={1} disabled={isAudio} placeholder={isAudio ? "Áudio vai sem legenda" : attachment ? "Legenda (opcional)…" : "Mensagem…"} aria-label={isAudio ? "Legenda (indisponível para áudio)" : attachment ? "Legenda" : "Mensagem"}
            onChange={(e) => { setText(e.target.value); setSel(0); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
            onKeyDown={(e) => {
              if (matches.length) {
                if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
                if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
                if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); fill(matches[sel]); return; }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); setText(""); return; }
              }
              if (e.key === "Escape" && !text.trim() && (replyTo || attachment)) {
                e.stopPropagation(); e.nativeEvent.stopImmediatePropagation();
                if (replyTo) onClearReply?.(); else setAttachment(null);
                return;
              }
              if (e.key === "Escape" && text.trim()) { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); (e.target as HTMLTextAreaElement).blur(); return; }
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            className="min-w-0 flex-1 resize-none bg-paper-2 rounded-[var(--radius-control)] px-3.5 py-2.5 text-[16px] lg:text-base leading-relaxed outline-none focus:bg-paper focus:shadow-[0_0_0_1px_var(--color-ink),0_0_0_4px_rgb(184_134_63/0.2)] transition-shadow max-h-40 disabled:opacity-50 disabled:cursor-not-allowed" />
          {canSend || !canRecord ? (
            <motion.button type="button" onClick={send} disabled={!canSend || pending} whileTap={{ scale: 0.92 }} aria-label="Enviar"
              className="size-11 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-ink text-paper disabled:opacity-35 transition-opacity">
              {pending ? <span className="size-4 rounded-full border-2 border-paper border-r-transparent animate-spin" /> : <IconSend size={18} />}
            </motion.button>
          ) : (
            <motion.button type="button" onClick={startRecording} whileTap={{ scale: 0.92 }} aria-label="Gravar áudio" title="Gravar áudio"
              className="size-11 shrink-0 grid place-items-center rounded-[var(--radius-control)] bg-ink text-paper"><IconMic size={18} /></motion.button>
          )}
        </div>
      )}
      <p className="text-xs text-muted mt-1.5 px-1 hidden sm:block"><b className="text-graphite">/</b> respostas prontas · Enter envia · Shift+Enter quebra linha</p>
    </div>
  );
}
