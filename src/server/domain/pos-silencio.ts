import { and, eq, gt, isNotNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { messages } from "../db/schema";
import { isOpen } from "../../lib/business-hours";
import { fillName } from "../../lib/auto-message-text";
import { SO_LINK_SQL } from "../../lib/so-link";
import { funcaoLigada, funcaoParam, funcaoTexto } from "./funcoes";
import { getBusinessHours } from "./hours";
import { enqueueAutomated, POS_SILENCIO_SOURCE } from "./outbox";

/**
 * Mensagem depois do silêncio (Cati 31/10): cliente nova que só mandou link, recebeu as boas-vindas e não respondeu. Uma vez só, no horário
 * de funcionamento. A janela de 24 h depois do tempo escolhido evita pegar conversa antiga quando a função é ligada.
 */
export async function sweepPosSilencio(now = new Date()): Promise<number> {
  if (!(await funcaoLigada("pos_silencio"))) return 0;
  if (!isOpen(now.getTime(), await getBusinessHours())) return 0;
  const texto = (await funcaoTexto("pos_silencio", "texto")).trim();
  if (!texto) return 0;
  const horas = await funcaoParam("pos_silencio", "horas");
  const ate = new Date(now.getTime() - horas * 3_600_000), desde = new Date(ate.getTime() - 24 * 3_600_000);
  const rows = await db.execute<{ id: string; name: string }>(sql`
    select d.id, c.name from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
    where s.kind = 'lead' and d.closed_at is null and d.archived_at is null and d.conversation_archived_at is null and d.awaiting_reply_since is null
      and d.first_response_at is null and c.kind = 'cliente' and not c.ignored and c.consent_whatsapp is not false
      and d.last_outbound_at > ${desde.toISOString()}::timestamptz and d.last_outbound_at <= ${ate.toISOString()}::timestamptz
      and not exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'in' and not (m.kind = 'text' and m.body ~* ${SO_LINK_SQL}))
      and not exists (select 1 from messages m where m.deal_id = d.id and m.direction = 'out' and (m.sent_by_user_id is not null or m.from_phone))
      and not exists (select 1 from outbox o where o.deal_id = d.id and o.options->>'source' = ${POS_SILENCIO_SOURCE})
    limit 20`);
  for (const r of rows.rows) await enqueueAutomated({ dealId: r.id, kind: "text", text: fillName(texto, r.name), source: POS_SILENCIO_SOURCE, at: now });
  return rows.rows.length;
}

/** Reconfere na hora de sair. */
export async function posSilencioCancelReason(dealId: string, createdAt: Date): Promise<string | null> {
  if (!(await funcaoLigada("pos_silencio"))) return "A Mensagem depois do silêncio foi desligada.";
  const [m] = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.dealId, dealId), gt(messages.createdAt, createdAt),
    or(eq(messages.direction, "in"), isNotNull(messages.sentByUserId), eq(messages.fromPhone, true)))).limit(1);
  return m ? "A cliente escreveu ou alguém da Casa respondeu." : null;
}
