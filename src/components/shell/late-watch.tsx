"use client";
import { useEffect, useRef, useState } from "react";
import { applyLateTitle, lateAnnouncement } from "@/lib/late";
import { useCrossedThreshold } from "@/components/motion/use-crossed-threshold";
import { useLive } from "./live";
import { lateSoundOn, playAlert } from "./sound";

/** Eventos ao vivo que podem mudar quem está atrasado. */
const RELEVANT = new Set(["regras", "alerta", "lead_criado", "lead_atualizado", "lead_arquivado", "lead_restaurado", "mensagem_recebida", "mensagem_enviada", "resposta", "etapa_alterada", "historico_importado", "reconectado"]);
const DEBOUNCE_MS = 2000;

/**
 * Quando um lead passa do prazo: põe "(N) atrasados · Casa Fiaes" no título da aba e anuncia
 * "lead atrasado" para leitor de tela. Som só com "Som no atraso" ligado no sino (desligado por padrão). `initial` vem do servidor (layout); nos eventos ao vivo o número é buscado em
 * /api/alertas/atrasados, também com a aba oculta (sem router.refresh), então título e som funcionam em segundo plano.
 */
export function LateWatch({ initial }: { initial: number }) {
  const { subscribe } = useLive();
  // Número buscado pelos eventos; vale só enquanto o do servidor não mudou (um refresh traz o dado novo).
  const [fetched, setFetched] = useState<{ base: number; n: number } | null>(null);
  const n = fetched && fetched.base === initial ? fetched.n : initial;
  const [message, setMessage] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const load = async () => {
      try {
        const r = await fetch("/api/alertas/atrasados", { cache: "no-store" });
        if (!r.ok || stopped) return;
        const j = (await r.json()) as { n?: unknown };
        if (typeof j.n === "number" && !stopped) setFetched({ base: initial, n: j.n });
      } catch { /* sem rede: o próximo evento tenta de novo */ }
    };
    const off = subscribe((e) => {
      if (!RELEVANT.has(e.type)) return;
      clearTimeout(timer);
      timer = setTimeout(load, DEBOUNCE_MS);
    });
    return () => { stopped = true; clearTimeout(timer); off(); };
  }, [subscribe, initial]);

  // Região aria-live: a cada subida anuncia o total atual; limpa antes de escrever para o mesmo texto ser lido de novo.
  const announceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // "Cruzou o limite" aqui é o número subir (0 -> 1, mas também 2 -> 3): o limite anda com o valor anterior. Nunca na primeira pintura.
  const rose = useCrossedThreshold(n, (prev) => prev + 1);
  useEffect(() => {
    if (!rose) return;
    // Som do atraso só se a pessoa ligou no sino (desligado por padrão: o som fica para "a cliente escreveu").
    if (lateSoundOn()) playAlert();
    clearTimeout(announceTimer.current);
    const clear = setTimeout(() => setMessage(""), 0); // limpa antes de escrever, para o mesmo texto ser lido de novo
    announceTimer.current = setTimeout(() => setMessage(lateAnnouncement(n)), 80);
    return () => clearTimeout(clear);
  }, [rose, n]);
  useEffect(() => () => clearTimeout(announceTimer.current), []);

  // Título: o Next reescreve o <title> a cada navegação; aplicamos o nosso por cima e devolvemos o original em N = 0.
  const original = useRef("");
  useEffect(() => {
    const apply = () => {
      const r = applyLateTitle(document.title, n, original.current);
      original.current = r.original;
      if (document.title !== r.title) document.title = r.title;
    };
    apply();
    if (n === 0) return;
    const obs = new MutationObserver(apply);
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [n]);

  return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="late-live">{n > 0 ? message : ""}</div>;
}
