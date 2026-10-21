"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconMic } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { transcreverDitadoAction } from "@/app/(app)/conversa/ai-actions";
import { cn } from "@/lib/cn";

/** Chrome/Firefox gravam webm/ogg; Safari/iPhone grava mp4 (o mesmo do gravador de áudio da caixa de mensagem). */
const RECORD_TYPES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
const pickRecordType = () => (typeof MediaRecorder === "undefined" ? null : RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null);
const canRecordNow = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!pickRecordType();
const noop = () => () => {};
/** Ditado é curto: para sozinho em 2 minutos (o servidor transcreve até isso). */
export const DITADO_MAX_SEC = 120;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/**
 * "Falar" (pedido da Cati, 16/10): a atendente grava um áudio curto com o que quer dizer; ao parar, o servidor transcreve com o MESMO transcritor
 * dos áudios do WhatsApp e o texto entra no campo, somado ao que já estava. `onTranscribed` (o "Sugerir resposta" usa) recebe o texto completo
 * para seguir sozinho. O áudio não fica guardado e nada é enviado. Sem microfone/gravador no navegador, o botão não aparece. Tocar de novo para.
 */
export function DictateButton({ value, onChange, onTranscribed, className }: { value: string; onChange: (v: string) => void; onTranscribed?: (v: string) => void; className?: string }) {
  // Só no navegador (no servidor, sem botão): evita diferença na hidratação.
  const supported = useSyncExternalStore(noop, canRecordNow, () => false);
  const [state, setState] = useState<{ k: "parado" } | { k: "gravando"; s: number } | { k: "transcrevendo" }>({ k: "parado" });
  const toast = useToast();
  const latest = useRef(value);
  useEffect(() => { latest.current = value; }, [value]);
  const rec = useRef<{ r: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setInterval>; cancelled: boolean } | null>(null);
  useEffect(() => () => { const c = rec.current; if (c) { c.cancelled = true; clearInterval(c.timer); if (c.r.state !== "inactive") c.r.stop(); c.stream.getTracks().forEach((t) => t.stop()); } }, []);
  if (!supported) return null;

  const transcrever = async (blob: Blob) => {
    setState({ k: "transcrevendo" });
    try {
      const fd = new FormData();
      fd.append("audio", blob, `ditado.${blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm"}`);
      const r = await transcreverDitadoAction(fd);
      if (!r.ok) { toast(r.error, "error"); return; }
      const full = [latest.current.trim(), r.data.texto].filter(Boolean).join(" ").slice(0, 1000);
      onChange(full);
      onTranscribed?.(full);
    } catch { toast("Não deu para transcrever agora. Tente de novo ou digite.", "error"); }
    finally { setState({ k: "parado" }); }
  };

  const start = async () => {
    const type = pickRecordType();
    if (!type || rec.current) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream, { mimeType: type });
      const chunks: Blob[] = [];
      const live = stream;
      let s = 0;
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      r.onstop = () => {
        const c = rec.current; rec.current = null;
        clearInterval(c?.timer); live.getTracks().forEach((t) => t.stop());
        if (!c || c.cancelled) return;
        if (!chunks.length) { setState({ k: "parado" }); return; }
        void transcrever(new Blob(chunks, { type: type.split(";")[0] }));
      };
      r.start();
      const timer = setInterval(() => { s += 1; setState({ k: "gravando", s }); if (s >= DITADO_MAX_SEC) r.stop(); }, 1000);
      rec.current = { r, stream: live, timer, cancelled: false };
      setState({ k: "gravando", s: 0 });
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      const name = e instanceof DOMException || e instanceof Error ? e.name : "";
      toast(name === "NotAllowedError" ? "Libere o microfone nas permissões do navegador." : name === "NotFoundError" ? "Nenhum microfone encontrado." : "Não deu para gravar neste navegador.", "error");
    }
  };
  const toggle = () => { if (state.k === "gravando") rec.current?.r.stop(); else if (state.k === "parado") void start(); };

  const on = state.k === "gravando";
  const busy = state.k === "transcrevendo";
  return (
    <button type="button" onClick={toggle} disabled={busy} aria-pressed={on} aria-label={on ? "Parar e usar o que falei" : busy ? "Transcrevendo o áudio" : "Falar em vez de digitar"}
      title={on ? "Gravando… toque para parar" : busy ? "Transcrevendo…" : "Falar em vez de digitar"}
      className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-sm transition-colors pointer-coarse:min-h-11 disabled:opacity-70",
        on ? "border-alert bg-alert-soft text-alert" : "border-line-strong bg-paper text-graphite hover:border-ink hover:text-ink", className)}>
      <IconMic size={15} aria-hidden />
      {on ? <>Parar <span className="tabular-nums">{clock(state.s)}</span></> : busy ? "Transcrevendo…" : "Falar"}
    </button>
  );
}
