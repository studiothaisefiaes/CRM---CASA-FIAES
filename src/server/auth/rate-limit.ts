// Limite simples em memória (um processo). Suficiente para o MVP local e um VPS.
const hits = new Map<string, number[]>();
export function allow(key: string, max = 5, windowMs = 10 * 60_000, now = Date.now()) {
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) { hits.set(key, list); return false; }
  list.push(now); hits.set(key, list); return true;
}
export function resetLimit(key: string) { hits.delete(key); }
