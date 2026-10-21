import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals } from "../db/schema";
import { UserFacingError } from "./errors";
import { holderIdOf } from "./people-on-number";
import { emit, logEvent } from "./events";
import { detectOrigin, findOpenDeal, stageByKind } from "./deals";
import { joinHiddenForPhone } from "./hidden-conversations";

/**
 * "Iniciar conversa" na ficha do contato. Nunca envia mensagem: só garante que existe um lead aberto para a atendente escrever.
 * - Já tem lead aberto: devolve esse (o índice `deals_one_open_per_contact` garante um só; não troca o dono).
 * - Não tem: cria um novo na etapa Atendimento, com quem iniciou de dona. Lead fechado ou perdido NÃO é reaberto (a venda dele continua nos números).
 * A origem fica sem evidência (canal não é origem): nos relatórios aparece como “Não identificada” até alguém dizer como a cliente conheceu a Casa.
 * - Pessoa a mais num número: abre a conversa do titular (é por ele que o WhatsApp fala).
 * - Contato "Não é cliente": recusa. Quem decide voltar é a pessoa, em "Voltar a ser cliente".
 * `userId` null (o Sistema, ex.: conversa de Equipe do resumo do dia): o lead nasce sem dona.
 * Duas chamadas ao mesmo tempo (duplo toque, duas abas) terminam no mesmo lead: a linha do contato é travada na transação.
 */
export async function startConversation(contactId: string, userId: string | null): Promise<{ dealId: string; created: boolean }> {
  // Pessoa a mais num número (filha, mãe…): a conversa é a do titular do número (0051).
  contactId = await holderIdOf(contactId);
  await adoptHiddenConversation(contactId);
  try { return await startConversationTx(contactId, userId); }
  catch (e) {
    // O lead abriu entre o lock e o INSERT (a entrada de mensagem não trava o contato): o índice único barrou o segundo. Leva ao que ficou aberto.
    if (!isOpenDealConflict(e)) throw e;
    const open = await findOpenDeal(contactId);
    if (!open) throw e;
    return { dealId: open.id, created: false };
  }
}

/**
 * A Casa pode ter acabado de escrever para a cliente por outro aparelho (ChatGuru) e o eco ter caído num contato "Número oculto" (@lid).
 * Se a Evolution já sabe o @lid deste número, a conversa do oculto passa a ser dela antes de decidir se abre outra (caso MANOELA, 17/10).
 * Falha na consulta não impede a conversa: segue como antes (a sugestão "É dela" aparece na conversa).
 */
async function adoptHiddenConversation(contactId: string) {
  const [c] = await db.select({ phone: contacts.phoneE164, waLid: contacts.waLid }).from(contacts).where(eq(contacts.id, contactId));
  if (!c || c.waLid || await findOpenDeal(contactId)) return;
  await joinHiddenForPhone(c.phone).catch((e) => console.error("[iniciar conversa] número oculto", e instanceof Error ? e.message : e));
}

/** Violação do índice `deals_one_open_per_contact` (o driver pode embrulhar o erro do Postgres em `cause`). */
const isOpenDealConflict = (e: unknown): boolean => {
  const err = e as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null;
  const pg = err?.code ? err : err?.cause;
  return pg?.code === "23505" && (pg.constraint ?? "deals_one_open_per_contact") === "deals_one_open_per_contact";
};

async function startConversationTx(contactId: string, userId: string | null): Promise<{ dealId: string; created: boolean }> {
  const result = await db.transaction(async (tx) => {
    const [c] = await tx.select().from(contacts).where(eq(contacts.id, contactId)).for("update");
    if (!c) throw new UserFacingError("Esse contato não existe mais.");
    const existing = await findOpenDeal(c.id, tx);
    if (existing) return { dealId: existing.id, created: false };
    if (c.ignored) throw new UserFacingError("Esse contato está como “Não é cliente”. Volte a ser cliente para iniciar uma conversa.");
    const stage = await stageByKind("atendimento", tx);
    // Hora do app, como nos leads que chegam pelo WhatsApp: misturar com o now() do banco inverte a ordem dos leads se os relógios divergirem.
    const at = new Date();
    const [d] = await tx.insert(deals).values({ contactId: c.id, stageId: stage.id, ownerId: userId, origin: detectOrigin({ isClient: c.isClient }), createdAt: at, stageEnteredAt: at }).returning();
    await logEvent(tx, d.id, "lead_criado", { origin: d.origin, initialStage: stage.key, historico: false, iniciadoPelaCasa: true }, userId);
    return { dealId: d.id, created: true };
  });
  if (result.created) await emit("lead_criado", { dealId: result.dealId });
  return result;
}
