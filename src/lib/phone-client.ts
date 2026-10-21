// Formatação leve para o navegador (sem carregar libphonenumber no cliente).
/** Pessoa a mais num número (filha, mãe…, 0051): o "telefone" dela é "pessoa:<uuid>"; a conversa é a do titular do número. */
export const PERSON_PHONE_PREFIX = "pessoa:";
/** Sugestões de "quem ela é" para o titular (o campo aceita qualquer texto curto). */
export const PHONE_RELATIONS = ["filha", "filho", "mãe", "pai", "marido", "esposa", "irmã", "irmão", "avó", "neta", "sobrinha", "amiga"] as const;
export const isPersonPhone = (e164: string | null | undefined) => !!e164?.startsWith(PERSON_PHONE_PREFIX);
/**
 * Sem número de WhatsApp próprio: contato que chegou sem número visível (@lid, "lid:<dígitos>") ou pessoa a mais num número ("pessoa:<uuid>").
 * Nunca se envia, liga ou mostra esse "telefone".
 */
export const isHiddenNumber = (e164: string | null | undefined) => !!e164?.startsWith("lid:") || isPersonPhone(e164);

export function formatPhoneClient(e164: string) {
  // Pedido do dono (16/10): nada de "Número oculto" na tela. Sem número visível, a linha do telefone some.
  if (isHiddenNumber(e164)) return "";
  const d = e164.replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 13) return `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.startsWith("55") && d.length === 12) return `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return e164;
}

/** Nome para mostrar quando a cliente não tem nome salvo: o telefone; sem número visível (@lid), "Cliente". */
export const nameFallback = (e164: string) => formatPhoneClient(e164) || "Cliente";
