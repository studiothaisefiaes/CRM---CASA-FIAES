/**
 * Limites da API, em memória (um processo, como o limite do login em auth/rate-limit.ts; o CRM roda num processo só no VPS). Janela
 * deslizante. Passou do limite = 429 com Retry-After (segundos até a tentativa mais velha da janela sair).
 * - Por chave: 120 pedidos por minuto no geral e 20 envios de WhatsApp.
 * - Envio de WhatsApp (revisão de segurança 26/10): também 20 por minuto por PESSOA (somando todas as chaves dela) e um teto da Casa
 *   toda pela API, 30 por minuto e 500 por dia. Mensagem para cliente não tem volta e o WhatsApp bloqueia número que dispara demais.
 * - Por IP: 30 pedidos por minuto sem chave ou com chave que não vale (quem tenta adivinhar chave).
 */
export const LIMITE_GERAL = 120;
export const LIMITE_ENVIOS = 20;
export const LIMITE_ENVIOS_PESSOA = 20;
export const LIMITE_ENVIOS_GLOBAL_MIN = 30;
export const LIMITE_ENVIOS_GLOBAL_DIA = 500;
export const LIMITE_IP_SEM_CHAVE = 30;
export const JANELA_MS = 60_000;
export const DIA_MS = 86_400_000;

/** Cada contador guarda a própria janela: a limpeza não pode jogar fora o de 24 h só porque passou um minuto. */
const batidas = new Map<string, { janela: number; lista: number[] }>();

export type Regra = { chave: string; max: number; janela?: number; now?: number };
export type Contagem = { ok: true } | { ok: false; retryAfter: number; regra: string };

/**
 * Confere TODAS as regras e só então conta a tentativa em todas (tudo ou nada): a regra que não cabe não gasta as outras.
 * Não coube: `retryAfter` em segundos (mínimo 1) e qual regra barrou.
 */
export function contarTodos(regras: readonly Regra[]): Contagem {
  const vistas = regras.map((r) => {
    const janela = r.janela ?? JANELA_MS, now = r.now ?? Date.now();
    const lista = (batidas.get(r.chave)?.lista ?? []).filter((t) => now - t < janela);
    batidas.set(r.chave, { janela, lista });
    return { ...r, janela, now, lista };
  });
  const barrou = vistas.find((v) => v.lista.length >= v.max);
  if (barrou) return { ok: false, retryAfter: Math.max(1, Math.ceil((barrou.lista[0] + barrou.janela - barrou.now) / 1000)), regra: barrou.chave };
  for (const v of vistas) v.lista.push(v.now);
  // Contadores parados não ficam na memória para sempre.
  if (batidas.size > 5_000) {
    const now = Date.now();
    for (const [k, v] of batidas) if (!v.lista.length || now - v.lista[v.lista.length - 1] >= v.janela) batidas.delete(k);
  }
  return { ok: true };
}

/** Uma regra só (o limite geral da chave, o do IP). */
export function contar(chave: string, max: number, now = Date.now(), janela = JANELA_MS): { ok: true } | { ok: false; retryAfter: number } {
  return contarTodos([{ chave, max, janela, now }]);
}

/** Só testes: zera os contadores. */
export const __zerarLimites = () => batidas.clear();
