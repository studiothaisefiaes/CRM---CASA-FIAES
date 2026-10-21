import { leadHref } from "./lead-href";

/** Chave do aviso "pediu folga" no sino da gestão (um por pedido). */
export const folgaAlertKey = (blockId: string) => `folga:${blockId}`;
/** Chave do aviso "pediu para remarcar pelo link" sem conversa aberta (um por link e minuto). Leva a cliente para abrir a ficha. */
export const remarcarAlertKey = (contactId: string | null, linkId: string, now: Date) => `link_remarcar:${contactId ?? "-"}:${linkId}:${now.toISOString().slice(0, 16)}`;

/** Chave do aviso "cancelou pelo link" (P7, 17/10): um por horário. O toque abre o horário cancelado na Agenda, no dia dele. */
export const cancelouAlertKey = (appointmentId: string, day: string) => `link_cancelou:${appointmentId}:${day}`;

/** Chave do aviso "pedido pelo site" (um por pedido e por pessoa que marca na Agenda). */
export const onlineAlertKey = (visitId: string, userId: string) => `online:${visitId}:${userId}`;

/** Para onde o toque no aviso do sino leva. Aviso sem conversa abre a tela certa; com conversa, a conversa. */
export function alertHref(a: { type: string; dealId: string | null; dedupeKey: string }): string {
  if (a.dealId) return leadHref(a.dealId);
  if (a.type === "folga_pedida") return "/agenda?pedidos=folga";
  if (a.type === "link_remarcar") {
    const contactId = a.dedupeKey.split(":")[1];
    return contactId && contactId !== "-" ? `/contatos/${contactId}` : "/agenda";
  }
  if (a.type === "avec_robo") return "/config/avec";
  if (a.type === "pedido_online") return "/agenda?pedidos=site";
  if (a.type === "link_cancelou") {
    const [, id, day] = a.dedupeKey.split(":");
    return id && day ? `/agenda?d=${day}&destaque=${id}` : "/agenda";
  }
  return leadHref(null);
}
