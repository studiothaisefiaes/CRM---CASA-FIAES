import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, contacts, deals } from "../db/schema";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { emit } from "./events";

/** Tipo do aviso "a cliente escreveu" no sino (um aberto por conversa; some ao abrir a conversa ou responder). */
export const CLIENT_MESSAGE_ALERT = "mensagem_cliente";
/** Mensagem mais velha que isso (reprocessamento, histórico) não acorda ninguém: só fica como não lida. */
export const CLIENT_MESSAGE_FRESH_MS = 6 * 3_600_000;
/** Em modo quieto, só avisa a mensagem de até 30 min: a recém-escrita; as que chegam atrasadas ao reconectar, não. */
export const QUIET_FRESH_MS = 30 * 60_000;
/** Intervalo mínimo entre dois pushes do aviso "escreveu" da mesma conversa. */
export const CLIENT_MESSAGE_PUSH_GAP_MS = 5 * 60_000;

const preview = (kind: string, body: string | null | undefined) => {
  const t = body?.replace(/\s+/g, " ").trim();
  if (t) return t.length > 80 ? `${t.slice(0, 79).trimEnd()}…` : t;
  return ({ audio: "áudio", image: "foto", video: "vídeo", document: "arquivo", sticker: "figurinha", call: "ligação" } as Record<string, string>)[kind] ?? "mensagem";
};

/**
 * Toda mensagem da cliente avisa, em QUALQUER etapa (Novo contato, Agendado, Na Casa, Atendida, encerrada…): o sino ganha (ou renova)
 * o aviso "Fulana escreveu" da conversa e o celular recebe o push. Antes, só o prazo da etapa avisava, e só nas etapas da automação:
 * cliente em Agendado escreveu e a Casa só soube pelo ChatGuru. Um aviso aberto por conversa (mensagens seguidas renovam o mesmo).
 * Vai para a dona; sem dona, para a gestão (a regra dos avisos de espera). Sem `wait_key`: não conta como atrasado.
 * Fica de fora: reação (não é mensagem), mensagem velha (reprocessada) e, com o canal em modo quieto, a de mais de 30 min (atrasada da reconexão).
 * Devolve o texto do aviso (ou null quando não avisou): vai no evento para a tela de cada pessoa da equipe mostrar a notificação.
 */
export async function noticeClientMessage(input: { dealId: string; messageId: string; kind: string; body: string | null | undefined; at: Date; now?: Date }): Promise<string | null> {
  const now = input.now ?? new Date();
  if (input.kind === "reaction" || now.getTime() - input.at.getTime() > CLIENT_MESSAGE_FRESH_MS) return null;
  const [d] = await db.select({ ownerId: deals.ownerId, lastOutboundAt: deals.lastOutboundAt, name: contacts.name, phone: contacts.phoneE164, quiet: sql<boolean>`(${channels.quietUntil} is not null and ${channels.quietUntil} > ${now.toISOString()}::timestamptz)` })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).leftJoin(channels, eq(channels.id, deals.channelId))
    .where(eq(deals.id, input.dealId));
  // Modo quieto (número recém-pareado): a cliente escrevendo agora avisa; só as atrasadas da reconexão ficam caladas (23/10: calar
  // tudo deixou a recepção 48 h sem "escreveu" depois do QR de 21/10).
  if (!d || (d.quiet && now.getTime() - input.at.getTime() > QUIET_FRESH_MS)) return null;
  // A Casa já respondeu depois dela (mensagem que chegou atrasada, resposta pelo celular): não é espera, como no awaitingReplySince.
  if (d.lastOutboundAt && d.lastOutboundAt >= input.at) return null;
  const message = alertText.clientMessage(clientLabel(d.name, d.phone), preview(input.kind, input.body));
  const target = { userId: d.ownerId, audience: d.ownerId ? "responsavel" : "gestao" };
  // Upsert numa instrução só, travado pelo índice único parcial (um aberto por conversa): o webhook processa em paralelo e o
  // "atualiza, senão insere" em dois passos criava 2–3 avisos (e pushes) para foto + texto no mesmo segundo.
  await db.insert(alerts).values({ dealId: input.dealId, ...target, type: CLIENT_MESSAGE_ALERT, severity: "info", message, dedupeKey: `${CLIENT_MESSAGE_ALERT}:${input.messageId}`, createdAt: now })
    .onConflictDoUpdate({
      target: alerts.dealId, targetWhere: sql`type = 'mensagem_cliente' and resolved_at is null`,
      // Push: no máximo um por conversa a cada 5 min. Mensagem nova renova o aviso no sino, mas só volta a notificar o celular
      // (pushed_at = null) se o último push foi há mais de 5 min; dentro disso mantém o pushed_at e o worker não reenvia.
      set: { message, ...target, createdAt: now, readAt: null,
        pushedAt: sql`case when ${alerts.pushedAt} > ${new Date(now.getTime() - CLIENT_MESSAGE_PUSH_GAP_MS).toISOString()}::timestamptz then ${alerts.pushedAt} else null end` },
    });
  await emit("alerta", { dealId: input.dealId });
  return message;
}

/** A conversa foi vista (aberta) ou respondida: o aviso "escreveu" sai do sino. */
export async function resolveClientMessageAlerts(dealId: string, now = new Date(), tx: Pick<typeof db, "update"> = db): Promise<void> {
  await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(alerts.dealId, dealId), eq(alerts.type, CLIENT_MESSAGE_ALERT), isNull(alerts.resolvedAt), gt(sql`${now.toISOString()}::timestamptz`, alerts.createdAt)));
}
