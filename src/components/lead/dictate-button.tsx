"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IconMic } from "@/components/icons";
import { cn } from "@/lib/cn";

/* Reconhecimento de voz do próprio navegador (Chrome/Edge): de graça e na hora, sem gravar nem guardar áudio no CRM. */
type Rec = { lang: string; continuous: boolean; interimResults: boolean; start(): void; stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null };
const noop = () => () => {};
const recognizer = (): (new () => Rec) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/**
 * "Falar" (pedido da Cati, 16/10): a atendente fala o que quer dizer e o texto entra no campo do tema, somado ao que já estava.
 * Sem suporte no navegador, o botão não aparece. Tocar de novo para de ouvir.
 */
export function DictateButton({ value, onChange, className }: { value: string; onChange: (v: string) => void; className?: string }) {
  // Só no navegador (no servidor, sem botão): evita diferença na hidratação.
  const supported = useSyncExternalStore(noop, () => !!recognizer(), () => false);
  const [on, setOn] = useState(false);
  const rec = useRef<Rec | null>(null);
  const base = useRef("");
  useEffect(() => () => rec.current?.stop(), []);
  if (!supported) return null;

  const toggle = () => {
    if (on) { rec.current?.stop(); return; }
    const R = recognizer();
    if (!R) return;
    const r = new R();
    r.lang = "pt-BR"; r.continuous = true; r.interimResults = true;
    base.current = value.trim();
    r.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      onChange([base.current, text.trim()].filter(Boolean).join(" ").slice(0, 1000));
    };
    r.onend = () => setOn(false);
    r.onerror = () => setOn(false);
    rec.current = r;
    r.start();
    setOn(true);
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? "Parar de ouvir" : "Falar em vez de digitar"} title={on ? "Ouvindo… toque para parar" : "Falar em vez de digitar"}
      className={cn("inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-sm transition-colors pointer-coarse:min-h-11",
        on ? "border-alert bg-alert-soft text-alert" : "border-line-strong bg-paper text-graphite hover:border-ink hover:text-ink", className)}>
      <IconMic size={15} aria-hidden />{on ? "Ouvindo…" : "Falar"}
    </button>
  );
}
