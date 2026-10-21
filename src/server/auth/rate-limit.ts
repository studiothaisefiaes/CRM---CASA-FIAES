// Limite simples em memória (um processo). Suficiente para o MVP local e um VPS.
const hits = new Map<string, number[]>();
export function allow(key: string, max = 5, windowMs = 10 * 60_000, now = Date.now()) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now); hits.set(key, list); return true;
}
export function resetLimit(key: string) { hits.delete(key); }
/** Já passou do limite? Só confere (não conta a tentativa). Para bloquear tudo de um IP que errou demais. */
export function blocked(key: string, max: number, windowMs = 10 * 60_000, now = Date.now()) {
  return (hits.get(key) ?? []).filter((t) => now - t < windowMs).length >= max;
}
