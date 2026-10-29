/**
 * Guarda o resultado de uma consulta pesada por alguns segundos, no processo (29/10, Cati: "demora para sair de uma aba para outra").
 * Só para números que podem atrasar um pouco (contagens de abas e filtros, listas de opções): nunca para a conversa ou a fila.
 * Duas telas pedindo juntas usam a mesma consulta em andamento.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX_KEYS = 200;

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = store.get(key);
  if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = fn();
  // Falhou: não guarda (a próxima tenta de novo).
  value.catch(() => { if (store.get(key)?.value === value) store.delete(key); });
  if (store.size >= MAX_KEYS) store.delete(store.keys().next().value!);
  store.set(key, { at: now, value });
  return value;
}
