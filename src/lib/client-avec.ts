/** Textos do Avec na ficha da cliente e na conversa (próximo horário, pacote, histórico). Puro: servidor e navegador. */
import { dueLabel } from "./next-action";
import type { PackageSituation } from "../server/queries/avec";

export const PACKAGE_SITUATION_LABEL: Record<PackageSituation, string> = {
  ativo: "Em uso",
  acabando: "Falta 1 sessão",
  vencendo: "Vence em breve",
  vencido: "Vencido",
  esgotado: "Sessões usadas",
};

/** "amanhã 14:30 · Escova · com MAIARA" (horário de Salvador). */
export function appointmentLine(a: { startsAt: string; serviceLabel: string; professionalName: string | null }, nowMs: number): string {
  return [dueLabel(new Date(a.startsAt).getTime(), nowMs), a.serviceLabel, a.professionalName ? `com ${a.professionalName}` : null].filter(Boolean).join(" · ");
}

/** "Hidratação 10x · 3 de 10 sessões". */
export function packageLine(p: { packageName: string; usedSessions: number; totalSessions: number }): string {
  return `${p.packageName} · ${p.usedSessions} de ${p.totalSessions} ${p.totalSessions === 1 ? "sessão" : "sessões"}`;
}

/** Quanto da barra de sessões está preenchido (0–100). */
export function packagePercent(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((used / total) * 100)));
}

/** "2026-10-05" → "05/10/2026"; vazio → "—". */
export const brDay = (day: string | null | undefined) => (day ? day.split("-").reverse().join("/") : "—");

export type HistoryDay<T> = { day: string; items: T[]; /** Soma do dia; null quando não há valor (quem não vê valores). */ totalCents: number | null };

/** Atendimentos/compras por dia, na ordem em que vieram (a consulta já manda o mais novo primeiro). */
export function groupHistory<T extends { soldOn: string; totalCents: number | null }>(items: T[]): HistoryDay<T>[] {
  const out: HistoryDay<T>[] = [];
  for (const i of items) {
    let g = out.at(-1);
    if (!g || g.day !== i.soldOn) out.push((g = { day: i.soldOn, items: [], totalCents: null }));
    g.items.push(i);
    if (i.totalCents != null) g.totalCents = (g.totalCents ?? 0) + i.totalCents;
  }
  return out;
}
