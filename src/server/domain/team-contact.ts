import { and, eq, isNotNull, isNull, notLike } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, contacts, deals } from "../db/schema";
import { emit } from "./events";
import { findOpenDeal, unignoreContact } from "./deals";

/**
 * "É da equipe" (e desfazer): número de funcionária. Antes a Casa usava "Não é cliente", que esconde a conversa e não avisa.
 * Marcado como Equipe, o contato deixa de ser "Não é cliente" (o lead arquivado volta, se não houver outro aberto), a conversa vai para a aba Equipe
 * (avisa normalmente: não lida, sino, som) e sai do funil, das métricas, dos prazos e das contagens da Fila. Os avisos de espera abertos se resolvem.
 */
export async function setTeamContact(contactId: string, isTeam: boolean, userId: string): Promise<{ dealId: string | null }> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw new Error("Contato não encontrado");
  if (isTeam && c.ignored) await unignoreContact(contactId, userId);
  await db.update(contacts).set({ isTeam }).where(eq(contacts.id, contactId));
  const open = await findOpenDeal(contactId);
  if (isTeam && open) {
    const now = new Date();
    // Fora dos prazos: os avisos de espera (atrasado) deste lead somem; o aviso "escreveu" continua até abrirem a conversa.
    await db.update(alerts).set({ resolvedAt: now }).where(and(eq(alerts.dealId, open.id), isNull(alerts.resolvedAt), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")));
  }
  await db.insert(auditLog).values({ userId, action: isTeam ? "marcou_equipe" : "desmarcou_equipe", entity: "contact", entityId: contactId, data: {} });
  if (open) await emit("lead_atualizado", { dealId: open.id });
  else await emit("lead_atualizado", {});
  return { dealId: open?.id ?? (await db.select({ id: deals.id }).from(deals).where(eq(deals.contactId, contactId)).limit(1))[0]?.id ?? null };
}
