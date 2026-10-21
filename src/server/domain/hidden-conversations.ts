import { and, eq, like } from "drizzle-orm";
import { db } from "../db";
import { contacts } from "../db/schema";
import { lidLookup } from "../whatsapp/lid-pairs";
import { mergeLidInto, type LidMergeResult } from "./lid-merge";

/**
 * Conversa que a Casa começou por outro aparelho (celular, ChatGuru) e cujo eco chegou só com o @lid: fica num contato "Número oculto"
 * até o WhatsApp revelar o número. Enquanto isso a cliente (pelo número) parece não ter conversa, e "Iniciar conversa" abria outra, vazia
 * (caso MANOELA, 17/10). Aqui: juntar sozinho quando a Evolution já sabe o par. Nunca junta por palpite: juntar errado põe a conversa de uma
 * pessoa na ficha de outra. O cartão "É dela · trazer para cá" foi tirado em 20/10: aparecia em todas as conversas e a equipe juntou 4 errado.
 */

const isRealPhone = (phone: string) => phone.startsWith("+");

/**
 * Número de verdade que pode ter um contato oculto: descobre o @lid (o do webhook ou o da Evolution) e junta o oculto nele.
 * Não faz nada se o contato já tem @lid, se não há contato oculto com esse @lid ou se a Evolution não sabe. Falha da Evolution: null.
 */
export async function joinHiddenForPhone(phone: string | null, lidHint: string | null = null): Promise<LidMergeResult | null> {
  if (!phone || !isRealPhone(phone)) return null;
  const [real] = await db.select({ waLid: contacts.waLid }).from(contacts).where(eq(contacts.phoneE164, phone));
  if (real?.waLid) return null; // já sabe o @lid: as mensagens já chegam certas
  const [anyHidden] = await db.select({ id: contacts.id }).from(contacts).where(like(contacts.phoneE164, "lid:%")).limit(1);
  if (!anyHidden) return null;
  const lid = lidHint ?? await lidLookup.lidForPhone(phone).catch(() => null);
  if (!lid) return null;
  const [hidden] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.waLid, lid), like(contacts.phoneE164, "lid:%")));
  if (!hidden) return null;
  return mergeLidInto(lid, phone);
}
