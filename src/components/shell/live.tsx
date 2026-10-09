"use client";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { playAlert } from "./sound";

type LiveEvent = { type: string; dealId?: string; [k: string]: unknown };
type Listener = (e: LiveEvent) => void;
const Ctx = createContext<{ subscribe: (l: Listener) => () => void }>({ subscribe: () => () => {} });
export const useLive = () => useContext(Ctx);

/** Mantém uma conexão SSE e atualiza a tela (router.refresh) quando algo muda no banco. */
export function LiveProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const listeners = useRef(new Set<Listener>());
  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const connect = () => {
      es = new EventSource("/api/stream");
      es.onmessage = (m) => {
        let ev: LiveEvent; try { ev = JSON.parse(m.data); } catch { return; }
        if (ev.type === "conectado") return;
        listeners.current.forEach((l) => l(ev));
        if (ev.type === "lead_criado") playAlert();
        clearTimeout(timer);
        timer = setTimeout(() => { if (document.visibilityState === "visible") router.refresh(); }, 250);
      };
      es.onerror = () => { es?.close(); if (!stopped) setTimeout(connect, 3000); };
    };
    connect();
    const onVisible = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; es?.close(); clearTimeout(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);
  return <Ctx.Provider value={{ subscribe: (l) => { listeners.current.add(l); return () => listeners.current.delete(l); } }}>{children}</Ctx.Provider>;
}
