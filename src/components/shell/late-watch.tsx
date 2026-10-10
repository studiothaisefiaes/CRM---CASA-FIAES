"use client";
import { useEffect, useRef, useState } from "react";
import { applyLateTitle, crossedUp, lateAnnouncement } from "@/lib/late";
import { useLive } from "./live";
import { playAlert } from "./sound";

/** Eventos ao vivo que podem mudar quem está atrasado. */
const RELEVANT = new Set(["regras", "alerta", "lead_criado", "lead_atualizado", "lead_arquivado", "lead_restaurado", "mensagem_recebida", "mensagem_enviada", "resposta", "etapa_alterada", "historico_importado", "reconectado"]);
const DEBOUNCE_MS = 2000;

/** Versão local de "cruzou o limite" (a T21 troca pela primitiva final): chama `onCross` só quando o número sobe. */
function useCrossedThreshold(count: number, onCross: (n: number) => void) {
  const prev = useRef<number | null>(null);
  const cb = useRef(onCross);
  useEffect(() => { cb.current = onCross; });
  useEffect(() => {
    const before = prev.current;
    prev.current = count;
    if (crossedUp(before, count)) cb.current(count);
  }, [count]);
}

/**
 * Quando um lead passa do prazo: toca o som, põe "(N) atrasados · Casa Fiaes" no título da aba e anuncia
 * "lead atrasado" para leitor de tela. `initial` vem do servidor (layout); nos eventos ao vivo o número é buscado em
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
  useCrossedThreshold(n, (now) => {
    playAlert();
    setMessage("");
    clearTimeout(announceTimer.current);
    announceTimer.current = setTimeout(() => setMessage(lateAnnouncement(now)), 80);
  });
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
