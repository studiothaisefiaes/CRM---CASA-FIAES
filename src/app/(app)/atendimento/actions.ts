"use server";
import { z } from "zod";
import { assertUser } from "@/server/auth/session";
import { getDealDetail, getDealSheetData, type DealDetail, type SheetDeal } from "@/server/queries/deal";
import { getQueueItem, nextWaitingId } from "@/server/queries/queue";
import { formatPhoneClient } from "@/lib/phone-client";

const SESSION_EXPIRED = "Sua sessão expirou. Entre de novo.";
/** Texto fixo para a tela: nunca o `message` cru do erro nem o JSON do zod. */
const failure = (e: unknown, fallback: string) => (e instanceof Error && e.message === SESSION_EXPIRED ? SESSION_EXPIRED : fallback);

/** Quem está vendo: o painel decide por aqui se mostra "Assumir" ou "Transferir para…". */
export type Viewer = { id: string; role: "gestor" | "atendente" };
export type ConversationResult = { ok: true; data: DealDetail; viewer: Viewer } | { ok: false; error: string };

/** A conversa e os dados do lead aberto na Fila. O cabeçalho já está na tela (vem do item da Fila); isto traz o resto. */
export async function getConversationAction(dealId: string): Promise<ConversationResult> {
  try {
    const user = await assertUser();
    const detail = await getDealDetail(z.string().uuid().parse(dealId));
    if (!detail) return { ok: false, error: "Esse lead não existe mais." };
    return { ok: true, data: detail, viewer: { id: user.id, role: user.role } };
  } catch (e) { return { ok: false, error: failure(e, "Não foi possível abrir a conversa. Tente de novo.") }; }
}

export type SheetResult = { ok: true; data: SheetDeal; viewer: Viewer } | { ok: false; error: string };

/** Só o que as folhas de agendar, fechar venda e perdido pedem (Quadro: soltar um card nessas colunas). Sem conversa: abre bem mais rápido que `getConversationAction`. */
export async function getDealForSheet(dealId: string): Promise<SheetResult> {
  try {
    const user = await assertUser();
    const data = await getDealSheetData(z.string().uuid().parse(dealId));
    if (!data) return { ok: false, error: "Esse lead não existe mais." };
    return { ok: true, data, viewer: { id: user.id, role: user.role } };
  } catch (e) { return { ok: false, error: failure(e, "Não foi possível abrir o lead. Tente de novo.") }; }
}

/** Quem espera há mais tempo, sem o lead atual: destino do "Próximo da fila" (com o nome, para o botão dizer quem é). `id: null` = a fila está em dia. */
export async function nextWaitingAction(dealId: string): Promise<{ ok: true; id: string | null; name: string | null } | { ok: false; error: string }> {
  try {
    const user = await assertUser();
    const id = await nextWaitingId(user, z.string().uuid().parse(dealId));
    const item = id ? await getQueueItem(id) : null;
    return { ok: true, id, name: item ? (item.name === item.phone ? formatPhoneClient(item.phone) : item.name) : null };
  } catch (e) { return { ok: false, error: failure(e, "Não foi possível buscar o próximo da fila.") }; }
}
