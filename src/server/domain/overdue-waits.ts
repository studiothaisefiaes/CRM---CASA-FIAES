import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, messages, stages } from "../db/schema";
import { closesConversation } from "./message-kinds";
import { moveToKindTx } from "./deals";
import { logEvent, emit } from "./events";

const OFFSET = "interval '3 hours'"; // America/Bahia

/**
 * Espera vencida (Lote 1C, decisão do dono): a CLIENTE escreveu e ninguém respondeu. Quem deve é a Casa, então:
 * - Novo contato / Em conversa: nada muda; continuam atrasadas, com a espera e os avisos (antes iam para Follow-up, o sentido invertido);
 * - Aguardando cliente / Orçamento enviado com a cliente esperando (sobra de antes da regra do recordInbound): voltam para
 *   Em conversa na hora, mantendo a espera;
 * - Agendado, espera de um dia que já passou: só sai da espera (não perde o horário).
 */
export async function sweepOverdueWaits(now = new Date()): Promise<{ moved: number; cleared: number }> {
  const today = sql`(${now.toISOString()}::timestamptz - ${sql.raw(OFFSET)})::date`;
  const rows = await db.select({ id: deals.id, kind: stages.kind })
    .from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), isNull(deals.conversationArchivedAt), isNotNull(deals.awaitingReplySince),
      or(inArray(stages.kind, ["followup", "proposta"]),
        and(eq(stages.kind, "agendado"), sql`(${deals.awaitingReplySince} - ${sql.raw(OFFSET)})::date < ${today}`))));
  let moved = 0, cleared = 0;
  for (const r of rows) {
    await db.transaction(async (tx) => {
      if (r.kind === "agendado") {
        await tx.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, r.id));
        await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
          .where(and(eq(alerts.dealId, r.id), isNull(alerts.resolvedAt)));
        cleared++;
        await logEvent(tx, r.id, "espera_vencida", { etapaAntes: r.kind, acao: "encerrada" });
      } else {
        await moveToKindTx(tx, r.id, "atendimento", null, "cliente_esperando", now);
        moved++;
        await logEvent(tx, r.id, "espera_vencida", { etapaAntes: r.kind, acao: "voltou_para_conversa" });
      }
    });
    await emit("lead_atualizado", { dealId: r.id });
  }
  return { moved, cleared };
}

/**
 * Conversa "esperando" só porque a cliente agradeceu ("Obrigada!", "ok", 👍) depois da resposta da Casa: não é espera (pedido da Casa, 14/10).
 * A entrada nova já não abre espera (closesConversation); esta varredura corrige as que ficaram abertas antes da regra (e qualquer caminho
 * que reabra). Só limpa quando TUDO o que a cliente mandou desde que a espera abriu é encerramento; resolve os avisos dessa espera.
 */
export async function sweepClosingWaits(now = new Date()): Promise<{ cleared: number }> {
  const open = await db.select({ id: deals.id, since: deals.awaitingReplySince })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId))
    .where(and(isNull(deals.closedAt), isNull(deals.archivedAt), isNotNull(deals.awaitingReplySince), isNotNull(deals.lastOutboundAt),
      sql`${deals.awaitingReplySince} > ${deals.lastOutboundAt}`));
  let cleared = 0;
  for (const d of open) {
    const ins = await db.select({ kind: messages.kind, body: messages.body }).from(messages)
      .where(and(eq(messages.dealId, d.id), eq(messages.direction, "in"), gte(messages.createdAt, d.since!)));
    if (!ins.length || !ins.every((m) => closesConversation(m.kind, m.body))) continue;
    await db.transaction(async (tx) => {
      await tx.update(deals).set({ awaitingReplySince: null }).where(and(eq(deals.id, d.id), eq(deals.awaitingReplySince, d.since!)));
      await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
        .where(and(eq(alerts.dealId, d.id), isNull(alerts.resolvedAt)));
      await logEvent(tx, d.id, "espera_encerrada_agradecimento", { mensagens: ins.length });
    });
    await emit("lead_atualizado", { dealId: d.id });
    cleared++;
  }
  return { cleared };
}
