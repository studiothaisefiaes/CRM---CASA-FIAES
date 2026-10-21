import { and, eq, isNotNull, isNull, notLike, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, contacts, deals } from "../db/schema";
import type { ContactKind } from "../../lib/contact-kind";
import { emit } from "./events";
import { findOpenDeal, unignoreContact } from "./deals";
import { archiveDeals } from "./archive";
import { archiveConversation } from "./conversation-archive";

/**
 * "Marcar como…" (Fila e conversa, 17/10): Cliente, Equipe, Fornecedor ou Spam.
 * - Cliente: volta ao normal. Saindo de Spam, o lead guardado volta (como o antigo "Voltar a ser cliente").
 * - Equipe: o mesmo do "É da equipe" (lista Equipe, avisa, fora do funil e dos números).
 * - Fornecedor: lista própria (Fornecedores), a conversa é resolvida na hora e sai da Fila, dos números e relatórios; sem mensagem automática nem lembrete.
 * - Spam: o antigo "Não é cliente": o lead é guardado (some da Fila, avisos resolvidos), recuperável em Filtros › Spam; sem automática, lembrete nem IA.
 * `is_team` e `ignored` seguem o tipo pelo gatilho do banco (0054). Nada é apagado.
 */
export async function setContactKind(contactId: string, kind: ContactKind, userId: string | null): Promise<{ before: ContactKind; changed: boolean; dealId: string | null; resolved: boolean }> {
  const [c] = await db.select({ kind: contacts.kind }).from(contacts).where(eq(contacts.id, contactId));
  if (!c) throw new Error("Contato não encontrado");
  const before = c.kind;
  if (before === kind) return { before, changed: false, dealId: (await findOpenDeal(contactId))?.id ?? null, resolved: false };

  // Saindo de Spam: o lead guardado volta primeiro (se não houver outro aberto); depois vale o tipo novo.
  if (before === "spam") {
    if (!userId) throw new Error("Tirar um contato de Spam pede uma pessoa responsável.");
    await unignoreContact(contactId, userId);
  }
  // Sem pessoa (o Sistema, ex.: número da equipe do resumo do dia) só dá para marcar Cliente ou Equipe: guardar lead e resolver conversa têm autor.
  if (!userId && (kind === "spam" || kind === "fornecedor")) throw new Error("Marcar como Spam ou Fornecedor pede uma pessoa responsável.");
  await db.update(contacts).set({ kind }).where(eq(contacts.id, contactId));
  const open = await findOpenDeal(contactId);
  if (open && kind !== "cliente") {
    // Fora dos prazos: os avisos de espera somem (Equipe continua avisando que escreveu; Fornecedor e Spam resolvem tudo abaixo).
    await db.update(alerts).set({ resolvedAt: new Date() })
      .where(and(eq(alerts.dealId, open.id), isNull(alerts.resolvedAt), isNotNull(alerts.waitKey), notLike(alerts.waitKey, "task:%")));
  }
  // Sai da Fila na hora (pedido de 17/10: o robô da Claro ficava aberto e a Cati não achava o Resolver):
  // Spam guarda o lead (o antigo "Não é cliente": avisos resolvidos, fora de tudo; o Desfazer devolve como estava);
  // Fornecedor resolve a conversa (o tipo já mudou, então a mensagem de encerramento não sai).
  let resolved = false;
  if (open && kind === "spam") await archiveDeals([open.id], userId as string);
  if (open && kind === "fornecedor" && !open.conversationArchivedAt) { await archiveConversation(open.id, userId as string); resolved = true; }
  await db.insert(auditLog).values({ userId, action: "tipo_contato", entity: "contact", entityId: contactId, data: { de: before, para: kind } });
  const dealId = open?.id ?? (await db.select({ id: deals.id }).from(deals).where(eq(deals.contactId, contactId)).orderBy(sql`${deals.createdAt} desc`).limit(1))[0]?.id ?? null;
  await emit("lead_atualizado", dealId ? { dealId } : {});
  return { before, changed: true, dealId, resolved };
}
