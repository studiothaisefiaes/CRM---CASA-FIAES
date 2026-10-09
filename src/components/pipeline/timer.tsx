"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { businessSecondsBetween, DEFAULT_HOURS, type BusinessHours } from "@/lib/business-hours";

/** Horário de atendimento da Casa (Configurações › Etapas): o cronômetro de espera só anda com a Casa aberta, igual ao motor de alertas. */
const HoursCtx = createContext<BusinessHours>(DEFAULT_HOURS);
export function HoursProvider({ hours, children }: { hours: BusinessHours; children: ReactNode }) {
  return <HoursCtx.Provider value={hours}>{children}</HoursCtx.Provider>;
}
export const useHours = () => useContext(HoursCtx);
const fmtWait = (s: number) => s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

/** Relógio compartilhado: um único setInterval para todos os cronômetros da tela. */
const subs = new Set<(n: number) => void>();
let iv: ReturnType<typeof setInterval> | null = null;
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    subs.add(setNow);
    if (!iv) iv = setInterval(() => { const n = Date.now(); subs.forEach((f) => f(n)); }, 1000);
    return () => { subs.delete(setNow); if (!subs.size && iv) { clearInterval(iv); iv = null; } };
  }, []);
  return now;
}

export type Urgency = "ok" | "warn" | "late";
export function urgencyOf(sinceIso: string | null, slaMinutes: number | null, now: number, hours: BusinessHours = DEFAULT_HOURS): Urgency {
  if (!sinceIso || !slaMinutes) return "ok";
  const sec = businessSecondsBetween(new Date(sinceIso).getTime(), now, hours);
  if (sec >= slaMinutes * 60) return "late";
  if (sec >= slaMinutes * 60 * 0.6) return "warn";
  return "ok";
}

export function useUrgency(sinceIso: string | null, slaMinutes: number | null) {
  const now = useNow();
  const hours = useContext(HoursCtx);
  const since = sinceIso ? new Date(sinceIso).getTime() : null;
  return { urgency: urgencyOf(sinceIso, slaMinutes, now, hours), label: since != null ? fmtWait(businessSecondsBetween(since, now, hours)) : null };
}
