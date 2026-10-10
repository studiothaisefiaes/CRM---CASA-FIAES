"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { countLate, crossedUp, lateAnnouncement, lateTitle } from "@/lib/late";
import type { AlertItem } from "@/server/queries/alerts";
import { playAlert } from "./sound";

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
 * "lead atrasado" para leitor de tela. Não toca no primeiro render nem em refresh sem mudança.
 */
export function LateWatch({ alerts }: { alerts: AlertItem[] }) {
  const n = useMemo(() => countLate(alerts), [alerts]);
  // Último total anunciado; só vale enquanto ainda há atrasados (zerou, a região esvazia).
  const [announced, setAnnounced] = useState(0);

  useCrossedThreshold(n, (now) => { playAlert(); setAnnounced(now); });

  // Título: o Next reescreve o <title> a cada navegação; guardamos o último título "dele" e reaplicamos o nosso.
  const original = useRef("");
  useEffect(() => {
    const ours = lateTitle(n, "");
    if (n > 0) {
      if (document.title !== ours) original.current = document.title;
      document.title = ours;
    } else if (original.current && document.title.includes("atrasados · ")) {
      document.title = original.current;
    }
    if (n === 0) return;
    const obs = new MutationObserver(() => {
      if (document.title === ours) return;
      original.current = document.title;
      document.title = ours;
    });
    obs.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => obs.disconnect();
  }, [n]);

  return <div role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="late-live">{n > 0 ? lateAnnouncement(announced) : ""}</div>;
}
