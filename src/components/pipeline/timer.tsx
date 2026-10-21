"use client";
import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { businessSecondsBetween, DEFAULT_HOURS, type BusinessHours } from "@/lib/business-hours";
import { slaLevel } from "@/lib/queue";

/** Horário de atendimento da Casa (Configurações › Etapas): o cronômetro de espera só anda com a Casa aberta, igual ao motor de alertas. */
const HoursCtx = createContext<BusinessHours>(DEFAULT_HOURS);
export function HoursProvider({ hours, children }: { hours: BusinessHours; children: ReactNode }) {
  return <HoursCtx.Provider value={hours}>{children}</HoursCtx.Provider>;
}
export const useHours = () => useContext(HoursCtx);
export const fmtWait = (s: number) => s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

/**
 * Relógio compartilhado: um único setInterval para todos os cronômetros da tela, num store lido com `useSyncExternalStore`.
 * `useNow` re-renderiza a cada segundo (use só em folhas pequenas). `useClock(select)` re-renderiza SÓ quando o valor derivado muda:
 * um cartão que só precisa saber "atrasou?" re-renderiza duas vezes na vida, não 3600 por hora.
 */
const listeners = new Set<() => void>();
let current = Date.now();
let iv: ReturnType<typeof setInterval> | null = null;
function tick() { current = Date.now(); listeners.forEach((l) => l()); }
/** Parado (sem ninguém inscrito) o valor envelhece; renovamos, mas nunca duas vezes dentro da mesma renderização. */
function snapshotNow() { if (!iv && Date.now() - current > 500) current = Date.now(); return current; }
function subscribe(l: () => void) {
  listeners.add(l);
  if (!iv) { current = Date.now(); iv = setInterval(tick, 1000); }
  return () => { listeners.delete(l); if (!listeners.size && iv) { clearInterval(iv); iv = null; } };
}
export function useNow() {
  return useSyncExternalStore(subscribe, snapshotNow, snapshotNow);
}
/**
 * Deriva um valor primitivo do relógio e só re-renderiza quando ele muda. `serverNow` é o "agora" da primeira pintura (servidor e hidratação):
 * assim a página renderiza igual nos dois lados, sem divergência, e o relógio real entra logo depois.
 */
export function useClock<T extends string | number | boolean | null>(select: (now: number) => T, serverNow?: number): T {
  return useSyncExternalStore(subscribe, () => select(snapshotNow()), () => select(serverNow ?? snapshotNow()));
}

export type Urgency = "ok" | "warn" | "late";
/** A regra única (`slaLevel`): vermelho só com alerta aberto; dourado a partir de 60% do prazo, inclusive quando já passou sem alerta. */
export function urgencyOf(sinceIso: string | null, slaMinutes: number | null, now: number, hours: BusinessHours = DEFAULT_HOURS, alert = false): Urgency {
  if (alert) return "late";
  if (!sinceIso) return "ok";
  const level = slaLevel({ awaiting: true, alert: false, waitSeconds: businessSecondsBetween(new Date(sinceIso).getTime(), now, hours), slaMinutes });
  return level === "near" || level === "over" ? "warn" : "ok";
}

export function useUrgency(sinceIso: string | null, slaMinutes: number | null, alert = false) {
  const now = useNow();
  const hours = useContext(HoursCtx);
  const since = sinceIso ? new Date(sinceIso).getTime() : null;
  return { urgency: urgencyOf(sinceIso, slaMinutes, now, hours, alert), label: since != null ? fmtWait(businessSecondsBetween(since, now, hours)) : null };
}

/** Só o nível de urgência (ok, atenção, atrasado): re-renderiza quando ele muda, não a cada segundo. */
export function useUrgencyLevel(sinceIso: string | null, slaMinutes: number | null, alert = false): Urgency {
  const hours = useContext(HoursCtx);
  return useClock((now) => urgencyOf(sinceIso, slaMinutes, now, hours, alert));
}
