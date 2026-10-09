"use client";
import { useEffect, useState } from "react";
import { elapsed } from "@/lib/format";

/** Relógio compartilhado: um único setInterval para todos os cronômetros da tela. */
const subs = new Set<(n: number) => void>();
let iv: ReturnType<typeof setInterval> | null = null;
function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    subs.add(setNow);
    if (!iv) iv = setInterval(() => { const n = Date.now(); subs.forEach((f) => f(n)); }, 1000);
    return () => { subs.delete(setNow); if (!subs.size && iv) { clearInterval(iv); iv = null; } };
  }, []);
  return now;
}

export type Urgency = "ok" | "warn" | "late";
export function urgencyOf(sinceIso: string | null, slaMinutes: number | null, now: number): Urgency {
  if (!sinceIso || !slaMinutes) return "ok";
  const sec = (now - new Date(sinceIso).getTime()) / 1000;
  if (sec >= slaMinutes * 60) return "late";
  if (sec >= slaMinutes * 60 * 0.6) return "warn";
  return "ok";
}

export function useUrgency(sinceIso: string | null, slaMinutes: number | null) {
  const now = useNow();
  return { urgency: urgencyOf(sinceIso, slaMinutes, now), label: sinceIso ? elapsed(sinceIso, now) : null };
}
