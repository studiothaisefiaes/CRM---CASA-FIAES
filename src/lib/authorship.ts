// src/lib/authorship.ts
import { parseSignature, signatureDisplayName } from "./signature";

/** "Sara Lima" → "Sara". */
export const firstName = (name: string | null | undefined): string | null => name?.trim().split(/\s+/)[0] || null;

/** Como a equipe se chama: pela assinatura ("CATI" → "Cati"); sem assinatura, o primeiro nome. */
export const teamShortName = (u: { name: string; signature?: string | null }): string =>
  signatureDisplayName(u.signature ?? null) ?? firstName(u.name) ?? u.name;

/** Rodapé do balão da Casa: "Cati · pelo celular · ", "Sara · " (pelo CRM), "pelo celular · " (sem assinatura) ou "automática · ". */
export function outMeta(m: { fromPhone: boolean; sentVia?: string | null; sender: string | null; body?: string | null }): string {
  const name = firstName(m.sender) ?? signatureDisplayName(parseSignature(m.body));
  const phone = m.sentVia ? m.sentVia === "celular" : m.fromPhone;
  if (phone) return name ? `${name} · pelo celular · ` : "pelo celular · ";
  return name ? `${name} · ` : "automática · ";
}

/** Quem escreveu a mensagem da Casa ("Cati"), pelo cadastro ou pela assinatura; automática ou sem assinatura: null. */
export const speakerOf = (m: { sender: string | null; body?: string | null }): string | null => firstName(m.sender) ?? signatureDisplayName(parseSignature(m.body));

/** Rodapé do balão quando o nome já vai no topo: só por onde saiu ("pelo celular · ", "automática · " ou nada, pelo CRM). */
export function outVia(m: { fromPhone: boolean; sentVia?: string | null; sender: string | null; body?: string | null }): string {
  const phone = m.sentVia ? m.sentVia === "celular" : m.fromPhone;
  if (phone) return "pelo celular · ";
  return speakerOf(m) ? "" : "automática · ";
}

/** Antes da última mensagem na Fila e no Quadro: "Sara: ", "Cati: " ou "Casa: " (automática ou sem assinatura). Mensagem da cliente: nada. */
export function lastMessagePrefix(direction: "in" | "out" | null, authorName?: string | null, body?: string | null): string | null {
  if (direction !== "out") return null;
  return `${firstName(authorName) ?? signatureDisplayName(parseSignature(body)) ?? "Casa"}: `;
}

/** Linha da dona: "Sara", "Dona: Sara · respondida por Cati", "Sem dono" ou "Sem dono · respondida por Cati". `repliedBy` só vem quando não é a dona. */
export function ownerLine(owner?: string | null, repliedBy?: string | null): string {
  const o = firstName(owner), r = firstName(repliedBy);
  if (!o) return r ? `Sem dono · respondida por ${r}` : "Sem dono";
  return r ? `Dona: ${o} · respondida por ${r}` : o;
}

/** Agenda: com quem está a conversa do horário (não confundir com a profissional que atende). */
export const conversationWith = (ownerName?: string | null): string => {
  const n = firstName(ownerName);
  return n ? `Conversa com: ${n}` : "Conversa sem dono";
};
