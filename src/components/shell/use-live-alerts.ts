"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlertItem } from "@/server/queries/alerts";
import { coalesce } from "@/lib/live-scope";
import { useLive } from "./live";

const DEBOUNCE_MS = 400;
const MAX_WAIT_MS = 2000;

/**
 * Os avisos do sino. `initial` vem do servidor (layout); nos eventos ao vivo (alerts, queue) busca /api/alertas, sem router.refresh,
 * então a página não recarrega a cada mensagem. O dado do servidor mais novo (um refresh de outra tela) sempre vale mais que o buscado.
 */
export function useLiveAlerts(initial: AlertItem[]) {
  const [fetched, setFetched] = useState<{ base: AlertItem[]; list: AlertItem[] } | null>(null);
  const base = useRef(initial);
  useEffect(() => { base.current = initial; });
  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/alertas", { cache: "no-store" });
      if (!r.ok) return;
      const list = (await r.json()) as AlertItem[];
      if (Array.isArray(list)) setFetched({ base: base.current, list });
    } catch { /* sem rede: o sino fica como estava */ }
  }, []);
  const schedule = useRef<ReturnType<typeof coalesce> | null>(null);
  useEffect(() => {
    const call = coalesce(() => { void reload(); }, DEBOUNCE_MS, MAX_WAIT_MS);
    schedule.current = call;
    return () => { call.cancel(); schedule.current = null; };
  }, [reload]);
  useLive(["alerts", "queue"], () => schedule.current?.());
  return { alerts: fetched && fetched.base === initial ? fetched.list : initial, reload };
}
