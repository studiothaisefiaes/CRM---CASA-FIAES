import { and, eq } from "drizzle-orm";
import { can, canSeeDealMoney, type Perm } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { formatPhoneClient } from "@/lib/phone-client";
import { defaultSignature, normalizeSignature } from "@/lib/signature";
import { db } from "@/server/db";
import { dealFollows, users } from "@/server/db/schema";
import type { SessionUser } from "@/server/auth/sessions-store";
import { getDealDetail, type DealDetail } from "./deal";
import { getQueueItem, nextWaitingId } from "./queue";
import { assertCanActOnDeal, OUT_OF_SCOPE } from "@/server/domain/deal-scope";
import { UserFacingError } from "@/server/domain/errors";
import { funcaoLigada, funcaoParam } from "@/server/domain/funcoes";

/** Quem está vendo: o painel decide por aqui se mostra "Assumir" ou "Transferir para…". */
export type Viewer = { id: string; perms: Perm[]; /** Como a mensagem sai assinada ("JOAQUIM"); null = sem assinatura. */ signature?: string | null };
export type ConversationResult = { ok: true; data: DealDetail; viewer: Viewer } | { ok: false; error: string };
export type NextWaitingResult = { ok: true; id: string | null; name: string | null } | { ok: false; error: string };

export const CONVERSATION_ERROR = "Não foi possível abrir a conversa. Tente de novo.";
export const CONVERSATION_GONE = "Essa conversa não existe mais.";

/**
 * A conversa e os dados do lead aberto na Fila, para quem já passou pela checagem de `atendimento.ver`.
 * Usada pela Server Action e pela rota GET /api/conversa/[id] (mesmo conteúdo; a rota não entra na fila das Server Actions).
 */
export async function conversationFor(user: SessionUser, dealId: string): Promise<ConversationResult> {
  if (!isUuid(dealId)) return { ok: false, error: CONVERSATION_ERROR };
  // Revisão de segurança 17/10 (M1): sem "Ver conversas de todas", só as próprias e as sem dono (a gestão não passa por consulta nenhuma).
  if (!(await canActOn(user, dealId))) return { ok: false, error: OUT_OF_SCOPE };
  const libraryOn = can(user.perms, "biblioteca.enviar") && (await funcaoLigada("biblioteca"));
  const [reagir, editar, localizacao, contato, encaminhar, naoLida, acompanhar] = await Promise.all([
    ["mensagem.reagir", "reagir"], ["mensagem.editar", "editar_mensagem"], ["mensagem.localizacao", "como_chegar"], ["mensagem.contato", "mandar_contato"], ["mensagem.encaminhar", "encaminhar"], ["conversa.nao_lida", "marcar_nao_lida"], ["conversa.acompanhar", "acompanhar"],
  ].map(async ([perm, fn]) => can(user.perms, perm as Perm) && (await funcaoLigada(fn))));
  const acompanhando = acompanhar && (await db.select({ d: dealFollows.dealId }).from(dealFollows).where(and(eq(dealFollows.userId, user.id), eq(dealFollows.dealId, dealId))).limit(1)).length > 0;
  const tools = { reagir, editar, localizacao, contato, encaminhar, naoLida, acompanhar, acompanhando, editWindowMin: editar ? await funcaoParam("editar_mensagem", "janela_min") : 0, maxDestinos: encaminhar ? await funcaoParam("encaminhar", "max_destinos") : 0,
    maxMensagens: encaminhar ? await funcaoParam("encaminhar", "max_mensagens") : 0 };
  const [detail, [me]] = await Promise.all([
    getDealDetail(dealId, { money: canSeeDealMoney(user.perms), viewer: { id: user.id, name: user.name, canShare: can(user.perms, "config.sistema"), canLibrary: libraryOn, tools } }),
    db.select({ signature: users.signature }).from(users).where(eq(users.id, user.id)),
  ]);
  if (!detail) return { ok: false, error: CONVERSATION_GONE };
  // A mesma assinatura do envio (send.ts): a cadastrada ou o 1º nome.
  const signature = me?.signature ? normalizeSignature(me.signature) : defaultSignature(user.name);
  return { ok: true, data: detail, viewer: { id: user.id, perms: user.perms, signature } };
}

/** O escopo de `assertCanActOnDeal` como sim/não (a leitura devolve o texto em vez de lançar). */
export async function canActOn(user: Pick<SessionUser, "id" | "perms">, dealId: string): Promise<boolean> {
  try { await assertCanActOnDeal(user, dealId); return true; } catch (e) { if (e instanceof UserFacingError) return false; throw e; }
}

/** Quem espera há mais tempo, sem o lead atual: destino do "Próximo da fila" (com o nome, para o botão dizer quem é). `id: null` = a fila está em dia. */
export async function nextWaitingFor(user: SessionUser, dealId: string): Promise<NextWaitingResult> {
  if (!isUuid(dealId)) return { ok: false, error: "Não foi possível buscar o próximo da fila." };
  const id = await nextWaitingId(user, dealId);
  const item = id ? await getQueueItem(id) : null;
  return { ok: true, id, name: item ? (item.name === item.phone ? formatPhoneClient(item.phone) : item.name) : null };
}
