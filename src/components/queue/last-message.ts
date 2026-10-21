import type { Msg } from "@/components/lead/conversation";
import type { QueueItem } from "@/server/queries/queue";
import { displayName } from "@/lib/display-name";
import { formatPhoneClient } from "@/lib/phone-client";

/** O nome do cabeçalho e do painel da conversa: em Título quando chegou em MAIÚSCULAS; sem nome, o telefone formatado. */
export function paneName(d: { contact: { name: string | null; phoneE164: string } } | null, item: Pick<QueueItem, "name" | "phone"> | null): string {
  if (d) { const n = d.contact.name?.trim(); return n ? displayName(n) : formatPhoneClient(d.contact.phoneE164); }
  if (!item) return "";
  return item.name === item.phone ? formatPhoneClient(item.phone) : displayName(item.name);
}

/** A última mensagem do item da Fila como balão, para a conversa não abrir vazia enquanto o histórico chega (com quem e por onde saiu). */
export const lastMessageOf = (item: QueueItem): Msg => ({
  id: "inicial", direction: item.lastDirection ?? "in", kind: item.lastKind ?? "text", body: item.lastMessage, status: item.lastDirection === "out" ? "sent" : "received",
  createdAt: item.lastAt ?? new Date(0).toISOString(), sender: item.lastAuthorName ?? null, fromPhone: item.lastSentVia === "celular", sentVia: item.lastSentVia ?? null,
});
