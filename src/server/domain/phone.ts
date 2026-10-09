import { parsePhoneNumberFromString } from "libphonenumber-js";

const DEFAULT_DDD = "71"; // Salvador

/**
 * Normaliza qualquer formato (WhatsApp JID, com ou sem +55, com máscara, número local de 8/9 dígitos)
 * para E.164. Retorna null se não for um telefone brasileiro plausível.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  const fromWhatsapp = s.includes("@");
  if (fromWhatsapp) {
    if (s.endsWith("@g.us") || s.endsWith("@broadcast") || s.endsWith("@lid")) return null; // grupo / lista / id anônimo
    s = s.split("@")[0].split(":")[0];
  }
  let digits = s.replace(/\D/g, "");
  if (!digits) return null;
  // Do WhatsApp o número já vem com o código do país: estrangeiro (+1, +351…) não pode virar DDD brasileiro.
  if (fromWhatsapp && !digits.startsWith("55")) {
    const intl = parsePhoneNumberFromString("+" + digits);
    return intl?.isValid() ? intl.number : null;
  }
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  // Número local sem DDD
  if (digits.length === 8 || digits.length === 9) digits = DEFAULT_DDD + digits;
  // Com DDD, sem país
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  if (!digits.startsWith("55")) {
    const intl = parsePhoneNumberFromString("+" + digits);
    return intl?.isValid() ? intl.number : null;
  }
  // Celular antigo de 8 dígitos (sem o 9): 55 + DDD + 8 dígitos começando com 6-9
  if (digits.length === 12) {
    const local = digits.slice(4);
    if (/^[6-9]/.test(local)) digits = digits.slice(0, 4) + "9" + local;
  }
  const p = parsePhoneNumberFromString("+" + digits, "BR");
  if (!p || !p.isValid()) return null;
  return p.number;
}

export function formatPhone(e164: string) {
  const p = parsePhoneNumberFromString(e164);
  return p ? p.formatNational() : e164;
}

/** JID que a Evolution espera para enviar. */
export function toWhatsappNumber(e164: string) {
  return e164.replace(/\D/g, "");
}
