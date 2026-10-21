/**
 * Se o `router.refresh()` do tempo real está a caminho. Trocar o `?lead=` (history.replaceState, que o Next transforma num "restore")
 * enquanto um refresh está a caminho faz o Next achar que a árvore não bate com a resposta: ele tenta de novo e, na segunda vez,
 * RECARREGA A PÁGINA INTEIRA (medido: ~1 s com 200 ms de rede, a Fila e as fotos de novo). Por isso a troca de conversa espera o refresh
 * terminar para mexer na URL (a tela troca na hora; só a barra de endereço espera, ver open-lead.ts).
 */
let refreshing = false;
let safety: ReturnType<typeof setTimeout> | undefined;
const waiting = new Set<() => void>();
/** Refresh preso (nunca terminou): depois disso a URL volta a ser trocada na hora. */
const MAX_WAIT_MS = 10_000;

export function setRefreshing(on: boolean) {
  clearTimeout(safety);
  refreshing = on;
  if (on) { safety = setTimeout(() => setRefreshing(false), MAX_WAIT_MS); return; }
  const fns = [...waiting];
  waiting.clear();
  for (const fn of fns) fn();
}

/**
 * A URL mudou por `history.replaceState` (troca de conversa) depois da última resposta do servidor. O Next guarda a árvore da URL antiga
 * nesse caso, e o `router.refresh()` seguinte não bate com a resposta (tenta de novo e, na segunda vez seguida, recarrega a página inteira).
 * Então o próximo refresh do tempo real vai como navegação para a URL de agora (`router.replace`), que traz a árvore certa.
 */
let urlAhead = false;
export const markUrlAhead = () => { urlAhead = true; };
export const takeUrlAhead = () => { const v = urlAhead; urlAhead = false; return v; };

/** Roda agora, ou quando o refresh a caminho terminar (a mesma função pedida várias vezes roda uma vez só). */
export function whenRefreshIdle(fn: () => void) {
  if (!refreshing) fn(); else waiting.add(fn);
}
