// src/server/domain/authorship.ts
import { eq, isNotNull } from "drizzle-orm";
import { db, type Tx } from "../db";
import { alerts, contacts, deals, users } from "../db/schema";
import { parseSignature, signatureKey } from "@/lib/signature";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { teamShortName } from "@/lib/authorship";

export type SentVia = "celular" | "crm";
export type SignatureOwner = { id: string; name: string; active: boolean };

/** Assinaturas cadastradas (Configurações › Equipe) → pessoa, pela chave sem acento. Inclui quem foi desativada: a mensagem antiga continua sendo dela. */
export async function signatureMap(tx: Tx | typeof db = db): Promise<Map<string, SignatureOwner>> {
  const rows = await tx.select({ id: users.id, name: users.name, active: users.active, signature: users.signature }).from(users).where(isNotNull(users.signature));
  return new Map(rows.map((r) => [signatureKey(r.signature!), { id: r.id, name: r.name, active: r.active }]));
}

/** Quem assinou a mensagem ("*SARA - CASA FIAES:*" → Sara), ou null (sem assinatura, ou nome que ninguém da equipe usa). */
export async function signerOf(tx: Tx | typeof db, body: string | null | undefined, map?: Map<string, SignatureOwner>): Promise<SignatureOwner | null> {
  const sig = parseSignature(body);
  if (!sig) return null;
  return (map ?? (await signatureMap(tx))).get(signatureKey(sig)) ?? null;
}

/** Por onde saiu a mensagem da Casa. Automática (e eco sem autora fora do celular) fica sem. */
export const sentViaOf = (m: { fromPhone?: boolean; automated?: boolean; authorId?: string | null }): SentVia | null =>
  m.automated ? null : m.fromPhone ? "celular" : m.authorId ? "crm" : null;

const bahiaDay = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/Bahia" });

/**
 * Outra pessoa respondeu a conversa de alguém: a dona continua a mesma e recebe UM aviso por dia, por conversa e por quem respondeu
 * (a gestão decide se transfere). Devolve se criou o aviso.
 */
export async function warnOwnerRepliedByOther(tx: Tx, p: { dealId: string; ownerId: string; authorId: string; at: Date }): Promise<boolean> {
  const [[who], [c]] = await Promise.all([
    tx.select({ name: users.name, signature: users.signature }).from(users).where(eq(users.id, p.authorId)),
    tx.select({ name: contacts.name, phone: contacts.phoneE164 }).from(contacts).innerJoin(deals, eq(deals.contactId, contacts.id)).where(eq(deals.id, p.dealId)),
  ]);
  const cliente = c ? clientLabel(c.name, c.phone) : "uma cliente";
  const r = await tx.insert(alerts).values({
    dealId: p.dealId, userId: p.ownerId, audience: "responsavel", type: "respondida_por_outra", severity: "info",
    message: alertText.repliedByOther(who ? teamShortName(who) : null, cliente),
    dedupeKey: `respondida:${p.dealId}:${p.authorId}:${bahiaDay(p.at)}`,
  }).onConflictDoNothing().returning({ id: alerts.id });
  return r.length > 0;
}
