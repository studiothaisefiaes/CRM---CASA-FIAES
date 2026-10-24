import { sql } from "drizzle-orm";
import { db } from "../db";
import { emit } from "./events";
import { getBusinessHours } from "./hours";
import { loseNoReplyTx } from "./funnel";

/** Dias sem a cliente responder depois da última mensagem da Casa. */
export const STALE_DAYS = 7;

/**
 * Organizar os parados (dono 24/10, uma vez): Em conversa em que a Casa falou por último há mais de `days` dias, sem combinado e sem horário
 * para a frente. Fora: quem escreveu por último (precisa de resposta), retomadas sem mensagem, Fornecedor/Spam/Equipe, outras etapas.
 */
export async function planStaleConversations(now = new Date(), days = STALE_DAYS): Promise<string[]> {
  const limit = new Date(now.getTime() - days * 86_400_000).toISOString();
  const rows = (await db.execute(sql`
    select d.id from deals d join stages s on s.id = d.stage_id join contacts c on c.id = d.contact_id
    where s.key = 'atendimento' and d.closed_at is null and d.archived_at is null and c.kind = 'cliente'
      and d.last_outbound_at is not null and d.last_outbound_at <= ${limit}::timestamptz
      and (d.last_inbound_at is null or d.last_inbound_at < d.last_outbound_at)
      and not exists (select 1 from tasks t where t.deal_id = d.id and t.done_at is null and t.due_at > ${now.toISOString()}::timestamptz)
      and not exists (select 1 from appointments a where a.contact_id = d.contact_id and a.starts_at > ${now.toISOString()}::timestamptz
        and a.status not in ('cancelado', 'faltou'))
    order by d.last_outbound_at`)).rows as { id: string }[];
  return rows.map((r) => r.id);
}

/** Cada uma vai para Perdido "Não respondeu mais" com o recontato em 30 dias, igual ao fim das 3 tentativas (desfaz movendo de volta). */
export async function applyStaleConversations(ids: string[], now = new Date()): Promise<{ moved: number; errors: string[] }> {
  const hours = await getBusinessHours();
  const out = { moved: 0, errors: [] as string[] };
  for (const id of ids) {
    try {
      await db.transaction((tx) => loseNoReplyTx(tx, id, now, hours));
      out.moved++;
      await emit("etapa_alterada", { dealId: id });
    } catch (e) { out.errors.push(`${id}: ${e instanceof Error ? e.message : e}`); }
  }
  return out;
}
