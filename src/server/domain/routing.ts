/**
 * Distribuição automática: quem recebe a conversa. Função pura; quem são as "livres" (disponível, com sinal e abaixo do limite)
 * o adaptador de banco decide antes (distribution.ts).
 */
export { AVAILABILITY, AVAILABILITY_LABEL, type Availability } from "../../lib/availability";

export type Candidate = { id: string; priority: number; load: number; lastAssignedAt: Date | null };

/**
 * 1) a preferência (dona anterior da cliente que volta), se estiver livre;
 * 2) senão: menor nível de prioridade → menos conversas esperando → há mais tempo sem receber (nunca recebeu primeiro) → id.
 */
export function chooseAssignee(cands: Candidate[], opts: { preferId?: string | null; excludeIds?: string[] } = {}): string | null {
  const out = new Set(opts.excludeIds ?? []);
  const pool = cands.filter((c) => !out.has(c.id));
  if (opts.preferId && pool.some((c) => c.id === opts.preferId)) return opts.preferId;
  const t = (d: Date | null) => (d ? d.getTime() : -Infinity);
  pool.sort((a, b) => a.priority - b.priority || a.load - b.load || t(a.lastAssignedAt) - t(b.lastAssignedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return pool[0]?.id ?? null;
}
