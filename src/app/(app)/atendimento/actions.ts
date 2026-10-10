"use server";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { getDealDetail, type DealDetail } from "@/server/queries/deal";
import { getQueueItem, nextWaitingId } from "@/server/queries/queue";
import { formatPhoneClient } from "@/lib/phone-client";

export type ConversationResult = { ok: true; data: DealDetail } | { ok: false; error: string };

/** A conversa e os dados do lead aberto na Fila. O cabeçalho já está na tela (vem do item da Fila); isto traz o resto. */
export async function getConversationAction(dealId: string): Promise<ConversationResult> {
  try {
    await assertUser();
    const detail = await getDealDetail(z.string().uuid().parse(dealId));
    if (!detail) return { ok: false, error: "Esse lead não existe mais." };
    return { ok: true, data: detail };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Não foi possível abrir a conversa." }; }
}

/** Quem espera há mais tempo, sem o lead atual: destino do "Próximo da fila" (com o nome, para o botão dizer quem é). `id: null` = a fila está em dia. */
export async function nextWaitingAction(dealId: string): Promise<{ ok: true; id: string | null; name: string | null } | { ok: false; error: string }> {
  try {
    const user = await assertUser();
    const id = await nextWaitingId(user, z.string().uuid().parse(dealId));
    const item = id ? await getQueueItem(id) : null;
    return { ok: true, id, name: item ? (item.name === item.phone ? formatPhoneClient(item.phone) : item.name) : null };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Não foi possível buscar o próximo." }; }
}
