import { clientLabel } from "./alert-copy";

/** Sequência com cara de telefone: 8 dígitos ou mais, com +, espaço, parênteses ou hífen no meio (ponto não: "17.10.2026" é data). */
const PHONE = /\+?\(?\d[\d\s()-]{6,}\d/g;
const hasLetters = (s: string | null | undefined) => !!s && /\p{L}/u.test(s);
const digitsOf = (s: string) => s.replace(/\D/g, "");
/** O número do texto é o da cliente: os últimos 8 dígitos batem (com ou sem DDI/DDD). */
const samePhone = (a: string, b: string) => a.length >= 8 && b.length >= 8 && a.slice(-8) === b.slice(-8);

/**
 * Telefone cru nunca aparece na tela (Hoje v3, 17/10: "Responder +557190000002"). O número no meio de um texto (título de combinado,
 * aviso do sino) vira o nome da cliente quando é o telefone dela (`phone`); número de outra pessoa, ou sem como conferir, vira
 * "cliente com final 1234" (nunca o nome errado). Inicial maiúscula quando abre o texto.
 */
export function hidePhone(text: string, name?: string | null, phone?: string | null): string {
  return text.replace(PHONE, (m, offset: number) => {
    const digits = digitsOf(m);
    if (digits.length < 8) return m;
    const mine = !!phone && samePhone(digits, digitsOf(phone));
    const label = mine && hasLetters(name) ? name!.trim() : clientLabel(null, `+${digits}`);
    return offset === 0 ? label[0].toLocaleUpperCase("pt-BR") + label.slice(1) : label;
  });
}
