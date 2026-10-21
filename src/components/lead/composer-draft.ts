/**
 * Rascunho da caixa de mensagem, por conversa (Lote 7B). O painel da cliente oferece um texto ("Enviar link de confirmação") e o Composer
 * mostra no campo. NADA é enviado: quem envia é a atendente, no botão Enviar (seção 9.3). Fica em memória e some ao recarregar.
 */
type Listener = (text: string) => void;
const current = new Map<string, string>();
const waiting = new Map<string, string>();
const listeners = new Map<string, Set<Listener>>();

/** O Composer conta o que está escrito, para o painel perguntar "Trocar o que você estava escrevendo?". */
export function reportComposerText(dealId: string, text: string) {
  if (text) current.set(dealId, text); else current.delete(dealId);
}
export const composerHasText = (dealId: string) => !!current.get(dealId)?.trim();

/** Oferece o texto ao Composer da conversa. Sem o Composer aberto (no celular, aba Dados), guarda até ele abrir. */
export function offerDraft(dealId: string, text: string): void {
  const ls = listeners.get(dealId);
  if (ls?.size) { ls.forEach((l) => l(text)); return; }
  waiting.set(dealId, text);
}

/** O Composer assina; se havia texto esperando, recebe na hora. Devolve o cancelar da assinatura. */
export function onDraft(dealId: string, l: Listener): () => void {
  const set = listeners.get(dealId) ?? new Set<Listener>();
  set.add(l);
  listeners.set(dealId, set);
  const w = waiting.get(dealId);
  if (w !== undefined) { waiting.delete(dealId); l(w); }
  return () => { set.delete(l); if (!set.size) listeners.delete(dealId); };
}

/* ---------- Rascunho guardado no navegador (20/10) ---------- */
// A atendente perdia o que estava escrevendo quando a tela recarregava (atualização do sistema, aba que dorme). O texto fica guardado por
// conversa no próprio navegador e volta ao abrir a conversa; some ao enviar (campo vazio) e depois de 3 dias.
const SAVED_MAX_AGE_MS = 3 * 86_400_000;
const savedKey = (dealId: string) => `rascunho:${dealId}`;

export function loadSavedDraft(dealId: string, now = Date.now()): string {
  try {
    const raw = window.localStorage.getItem(savedKey(dealId));
    if (!raw) return "";
    const v = JSON.parse(raw) as { t?: unknown; at?: unknown };
    if (typeof v.t !== "string" || typeof v.at !== "number" || now - v.at > SAVED_MAX_AGE_MS) { window.localStorage.removeItem(savedKey(dealId)); return ""; }
    return v.t;
  } catch { return ""; }
}

export function saveDraft(dealId: string, text: string, now = Date.now()): void {
  try {
    if (text.trim()) window.localStorage.setItem(savedKey(dealId), JSON.stringify({ t: text, at: now }));
    else window.localStorage.removeItem(savedKey(dealId));
  } catch { /* navegador sem armazenamento (janela anônima, bloqueado): a caixa funciona igual, só não guarda */ }
}
