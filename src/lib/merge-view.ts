import { isHiddenNumber } from "./phone-client";

/** O que a tela de unir mostra de um cadastro: nunca o número inteiro nem o CPF, só "final 1234" (ou "sem WhatsApp" para pessoa a mais e @lid). */
export type MergeSideView = { id: string; name: string | null; hint: string; hasWhatsapp: boolean };

export function phoneHint(e164: string): string {
  if (isHiddenNumber(e164)) return "sem número de WhatsApp";
  const d = e164.replace(/\D/g, "");
  return d.length >= 4 ? `final ${d.slice(-4)}` : "sem número";
}
export const mergeSideView = (s: { id: string; name: string | null; phone: string }): MergeSideView => ({ id: s.id, name: s.name, hint: phoneHint(s.phone), hasWhatsapp: !isHiddenNumber(s.phone) });

/** Qual cadastro sugerir para ficar: o que tem WhatsApp; empatando, o de mais histórico (conversas + horários + comandas + vendas + pacotes + fichas + fotos + notas). */
export function suggestKeep(a: { hasWhatsapp: boolean; moving: Record<string, number> }, b: { hasWhatsapp: boolean; moving: Record<string, number> }): "a" | "b" {
  if (a.hasWhatsapp !== b.hasWhatsapp) return a.hasWhatsapp ? "a" : "b";
  const total = (m: Record<string, number>) => Object.entries(m).filter(([k]) => k !== "pontos" && k !== "mensagens").reduce((n, [, v]) => n + v, 0);
  return total(b.moving) > total(a.moving) ? "b" : "a";
}
