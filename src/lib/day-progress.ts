/** Textos do progresso do dia (puro: servidor e navegador). Neutro, da Casa toda, sem ranking. */

/** "há 14 min", "há 2 h 10", "há 3 dias". */
export function waitedFor(sinceMs: number, nowMs: number): string {
  const min = Math.max(0, Math.floor((nowMs - sinceMs) / 60_000));
  if (min < 60) return `há ${min} min`;
  if (min < 24 * 60) { const h = Math.floor(min / 60), m = min % 60; return m ? `há ${h} h ${String(m).padStart(2, "0")}` : `há ${h} h`; }
  const d = Math.floor(min / (24 * 60));
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

/** A linha do topo da Fila: "12 de 15 respondidas hoje · a mais antiga espera há 14 min"; sem ninguém esperando, o estado vazio positivo. */
export function dayProgressText(p: { answered: number; total: number; waiting: number; oldestSince: Date | string | null }, nowMs: number): { text: string; done: boolean } | null {
  if (p.waiting === 0) return { text: p.answered > 0 ? `Ninguém esperando resposta. ${p.answered} ${p.answered === 1 ? "conversa respondida" : "conversas respondidas"} hoje.` : "Ninguém esperando resposta.", done: true };
  const oldest = p.oldestSince ? ` · a mais antiga espera ${waitedFor(new Date(p.oldestSince).getTime(), nowMs)}` : "";
  return { text: `${p.answered} de ${p.total} respondidas hoje${oldest}`, done: false };
}
