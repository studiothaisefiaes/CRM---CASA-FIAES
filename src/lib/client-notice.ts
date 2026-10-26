import { leadHref } from "./lead-href";

/** Título da notificação "a cliente escreveu" (o push do servidor usa o mesmo). */
export const CLIENT_MESSAGE_TITLE = "Mensagem de cliente";

/**
 * A notificação do sistema que cada tela da equipe mostra quando uma cliente escreve (Cati 24/10: só a dona da conversa recebia).
 * Só para o evento com `aviso` (o servidor já tirou mensagem velha, reação e canal quieto) e com o texto do aviso.
 * A etiqueta é o link da conversa, a mesma do push (public/sw.js): no mesmo aparelho uma substitui a outra.
 */
export function clientNotice(ev: { type: string; dealId?: string; [k: string]: unknown }): { title: string; body: string; url: string; tag: string } | null {
  if ((ev.type !== "mensagem_recebida" && ev.type !== "lead_criado") || ev.aviso !== true || typeof ev.texto !== "string" || !ev.texto) return null;
  const url = leadHref(ev.dealId);
  return { title: CLIENT_MESSAGE_TITLE, body: ev.texto, url, tag: url };
}
