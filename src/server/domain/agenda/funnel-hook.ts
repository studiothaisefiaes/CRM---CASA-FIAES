import { and, eq, gte, isNull } from "drizzle-orm";
import type { Tx } from "../../db";
import { contacts, messages } from "../../db/schema";
import { RECENT_CONVERSATION_DAYS, syncContactFunnelTx } from "../avec/funnel-sync";
import { holderIdOf } from "../people-on-number";

const DAY = 86_400_000;

/** Decisão 4 do dono: a agenda só mexe no funil de quem conversou com a Casa nos últimos 30 dias (e não está como "Não é cliente"). */
export async function hadRecentConversationTx(tx: Tx, contactId: string, now: Date): Promise<boolean> {
  const [row] = await tx.select({ id: messages.id }).from(messages).innerJoin(contacts, eq(contacts.id, messages.contactId))
    .where(and(eq(messages.contactId, contactId), eq(contacts.ignored, false), isNull(messages.importedAt), gte(messages.createdAt, new Date(now.getTime() - RECENT_CONVERSATION_DAYS * DAY))))
    .limit(1);
  return !!row;
}

/**
 * O gancho do funil (spec 6.5): depois de marcar, remarcar, cancelar ou mudar status, na mesma transação, a regra do 1C
 * (`syncContactFunnelTx`) leva a conversa para Agendado, Atendida ou Aguardando. A agenda nunca muda etapa por conta própria.
 * Cada cliente roda num savepoint: um erro no funil vai para o log e não desfaz a mudança da agenda.
 * Devolve os leads que mudaram (quem chama emite `etapa_alterada` depois do commit).
 */
export async function agendaFunnelTx(tx: Tx, contactIds: (string | null | undefined)[], now: Date): Promise<string[]> {
  const moved: string[] = [];
  // Horário de pessoa a mais num número (filha, mãe…, 0051): o funil é o da conversa do titular.
  const holders = new Set<string>();
  for (const c of new Set(contactIds.filter((x): x is string => !!x))) holders.add(await holderIdOf(c, tx));
  for (const id of holders) {
    if (!(await hadRecentConversationTx(tx, id, now))) continue;
    try {
      const r = await tx.transaction((sp) => syncContactFunnelTx(sp, id, now));
      if (r.result && r.dealId) moved.push(r.dealId);
    } catch (e) { console.error("[agenda → funil]", id, e); }
  }
  return moved;
}
