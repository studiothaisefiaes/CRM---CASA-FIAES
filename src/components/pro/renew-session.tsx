"use client";
import { useEffect } from "react";

const KEY = "cf-sessao-renovada";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bahia" });

/** Ao abrir o app (uma vez por dia): a sessão vai para 90 dias. Sem storage, tenta toda vez, o que é barato. Nunca quebra a tela. */
export function RenewSession() {
  useEffect(() => {
    let last: string | null = null;
    try { last = localStorage.getItem(KEY); } catch { /* sem storage */ }
    if (last === today()) return;
    fetch("/api/sessao/renovar", { method: "POST", cache: "no-store" })
      .then((r) => { if (r.ok) { try { localStorage.setItem(KEY, today()); } catch { /* sem storage */ } } })
      .catch(() => {});
  }, []);
  return null;
}
