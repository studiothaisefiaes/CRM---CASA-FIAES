import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "../db";
import { auditLog, contactTags, tags } from "../db/schema";
import { UserFacingError } from "./errors";
import { IMAGE_USE_TAG } from "./avec/context";

export type Tag = { id: string; name: string; color?: string | null };
export const TAG_MAX = 30;

/** "  vip  " → "vip"; vazio ou com mais de 30 caracteres: erro com o texto para a tela. */
export function normalizeTagName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new UserFacingError("Escreva o nome da etiqueta.");
  if (name.length > TAG_MAX) throw new UserFacingError(`Use até ${TAG_MAX} caracteres.`);
  return name;
}

/**
 * Etiquetas da cliente: qualquer pessoa da equipe cria na hora, escrevendo o nome. O mesmo nome (sem diferenciar maiúsculas e espaços nas pontas)
 * reaproveita a etiqueta que já existe, para não nascerem "VIP" e "vip". Ficam na cliente: valem também para as próximas conversas dela.
 * Etiqueta nova na cliente dispara as regras "Uma etiqueta ser colocada" (depois do commit, sem nunca derrubar quem etiquetou). `byRule`: posta por
 * uma regra, não dispara regra (sem laço A→B→A). `imported`: veio de importação (ChatGuru), não dispara nada.
 */
export async function addTag(contactId: string, rawName: string, userId: string | null, opts?: { byRule?: boolean; imported?: boolean }): Promise<Tag> {
  const { tag, added } = await db.transaction((tx) => addTagTx(tx, contactId, rawName, userId));
  if (added && !opts?.imported) {
    try {
      const { runEventRules } = await import("../rules/events");
      await runEventRules({ type: "etiqueta", contactId, tag: tag.name, at: new Date(), byRule: !!opts?.byRule });
    } catch (e) { console.error("[regras por acontecimento] etiqueta", contactId, e instanceof Error ? e.message : e); }
  }
  return tag;
}

/**
 * Põe a etiqueta dentro de uma transação, sem disparar regra: é o que a regra "Pôr a etiqueta" usa (o mesmo que `addTag` com `byRule`,
 * que nunca dispara regra de etiqueta). `added`: a cliente ainda não tinha.
 */
export async function addTagTx(tx: Tx, contactId: string, rawName: string, userId: string | null): Promise<{ tag: Tag; added: boolean }> {
  const name = normalizeTagName(rawName);
  await tx.insert(tags).values({ name, createdBy: userId }).onConflictDoNothing();
  const [tag] = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(sql`lower(${tags.name}) = lower(${name})`);
  const added = await tx.insert(contactTags).values({ contactId, tagId: tag.id, createdBy: userId }).onConflictDoNothing().returning();
  if (added.length && userId) await tx.insert(auditLog).values({ userId, action: "etiquetou", entity: "contact", entityId: contactId, data: { etiqueta: tag.name } });
  return { tag, added: added.length > 0 };
}

export async function removeTag(contactId: string, tagId: string, userId: string): Promise<void> {
  await db.transaction((tx) => removeTagTx(tx, contactId, tagId, userId));
}

/** Tira a etiqueta dentro de uma transação. `userId` nulo = o sistema (regra): sem linha na auditoria de pessoa. */
export async function removeTagTx(tx: Tx, contactId: string, tagId: string, userId: string | null): Promise<boolean> {
  const gone = await tx.delete(contactTags).where(and(eq(contactTags.contactId, contactId), eq(contactTags.tagId, tagId))).returning();
  if (gone.length && userId) await tx.insert(auditLog).values({ userId, action: "tirou_etiqueta", entity: "contact", entityId: contactId, data: { tagId } });
  return gone.length > 0;
}

/** A etiqueta pelo nome (sem diferenciar maiúsculas e espaços nas pontas), ou null. */
export async function tagByName(tx: Tx | typeof db, rawName: string): Promise<Tag | null> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) return null;
  const [t] = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(sql`lower(${tags.name}) = lower(${name})`);
  return t ?? null;
}

/** Etiquetas de várias clientes de uma vez (Fila e conversa), em ordem alfabética. Cliente sem etiqueta não entra no mapa. */
export async function tagsOf(contactIds: string[]): Promise<Map<string, Tag[]>> {
  const out = new Map<string, Tag[]>();
  if (!contactIds.length) return out;
  const rows = await db.select({ contactId: contactTags.contactId, id: tags.id, name: tags.name, color: tags.color }).from(contactTags).innerJoin(tags, eq(tags.id, contactTags.tagId))
    .where(inArray(contactTags.contactId, [...new Set(contactIds)])).orderBy(asc(sql`lower(${tags.name})`));
  for (const r of rows) out.set(r.contactId, [...(out.get(r.contactId) ?? []), { id: r.id, name: r.name, ...(r.color ? { color: r.color } : {}) }]);
  return out;
}

/** Todas as etiquetas (para sugerir ao escrever), com quantas clientes usam cada uma. */
export async function listTags(): Promise<(Tag & { uses: number })[]> {
  return db.select({ id: tags.id, name: tags.name, uses: sql<number>`count(${contactTags.contactId})::int` }).from(tags)
    .leftJoin(contactTags, eq(contactTags.tagId, tags.id)).groupBy(tags.id).orderBy(asc(sql`lower(${tags.name})`));
}

/** A mesma etiqueta em várias clientes de uma vez (Contatos › ações em massa). Quem já tinha não conta; auditoria com o total. */
export async function bulkTagContacts(contactIds: string[], rawName: string, userId: string): Promise<{ tag: Tag; tagged: number }> {
  const name = normalizeTagName(rawName);
  const ids = [...new Set(contactIds)];
  return db.transaction(async (tx) => {
    await tx.insert(tags).values({ name, createdBy: userId }).onConflictDoNothing();
    const [tag] = await tx.select({ id: tags.id, name: tags.name }).from(tags).where(sql`lower(${tags.name}) = lower(${name})`);
    const added = ids.length
      ? await tx.insert(contactTags).values(ids.map((contactId) => ({ contactId, tagId: tag.id, createdBy: userId }))).onConflictDoNothing().returning({ contactId: contactTags.contactId })
      : [];
    if (added.length) await tx.insert(auditLog).values({ userId, action: "etiquetou_em_massa", entity: "contacts", data: { etiqueta: tag.name, contatos: added.length } });
    return { tag, tagged: added.length };
  });
}

/* ───────────── Configurações › Etiquetas (Lote 4) ───────────── */

export { TAG_COLORS } from "../../lib/tag-colors";
export type TagAdmin = { id: string; name: string; color: string | null; uses: number; protected: boolean };
const HEX = /^#[0-9a-f]{6}$/i;
/** A etiqueta antiga "Uso de imagem" (a importação do Avec não a cria mais, 0081) fica protegida: quem já a tem não perde o nome nem a junção. */
const isProtected = (name: string) => name.trim().toLowerCase() === IMAGE_USE_TAG.toLowerCase();

/** Todas as etiquetas, mais usadas primeiro, com quantas clientes têm cada uma. */
export async function listTagsAdmin(): Promise<TagAdmin[]> {
  const rows = await db.select({ id: tags.id, name: tags.name, color: tags.color, uses: sql<number>`count(${contactTags.contactId})::int` }).from(tags)
    .leftJoin(contactTags, eq(contactTags.tagId, tags.id)).groupBy(tags.id)
    .orderBy(desc(sql`count(${contactTags.contactId})`), asc(sql`lower(${tags.name})`));
  return rows.map((r) => ({ ...r, protected: isProtected(r.name) }));
}

export async function renameTag(id: string, rawName: string, userId: string): Promise<Tag> {
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!name) throw new UserFacingError("Escreva o nome da etiqueta.");
  if (name.length > TAG_MAX) throw new UserFacingError(`Use até ${TAG_MAX} caracteres.`);
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tags).where(eq(tags.id, id));
    if (!cur) throw new UserFacingError("Essa etiqueta não existe mais.");
    if (isProtected(cur.name)) throw new UserFacingError(`"${IMAGE_USE_TAG}" vem da importação do Avec e não muda de nome.`);
    const [other] = await tx.select({ id: tags.id }).from(tags).where(sql`lower(${tags.name}) = lower(${name}) and ${tags.id} <> ${id}`);
    if (other) throw new UserFacingError(`Já existe a etiqueta "${name}". Para unir as duas, use Juntar.`);
    await tx.update(tags).set({ name }).where(eq(tags.id, id));
    await tx.insert(auditLog).values({ userId, action: "renomeou_etiqueta", entity: "tag", entityId: id, data: { de: cur.name, para: name } });
    return { id, name, color: cur.color };
  });
}

export async function setTagColor(id: string, color: string | null, userId: string): Promise<void> {
  if (color !== null && !HEX.test(color)) throw new UserFacingError("Escolha uma das cores.");
  const [t] = await db.update(tags).set({ color: color ? color.toLowerCase() : null }).where(eq(tags.id, id)).returning({ id: tags.id });
  if (!t) throw new UserFacingError("Essa etiqueta não existe mais.");
  await db.insert(auditLog).values({ userId, action: "coloriu_etiqueta", entity: "tag", entityId: id, data: { cor: color } });
}

/** Juntar: as clientes de `fromId` passam para `intoId` (sem repetir) e `fromId` deixa de existir. */
export async function mergeTags(fromId: string, intoId: string, userId: string): Promise<{ moved: number }> {
  if (fromId === intoId) throw new UserFacingError("Escolha outra etiqueta para juntar.");
  return db.transaction(async (tx) => {
    const [from] = await tx.select().from(tags).where(eq(tags.id, fromId));
    const [into] = await tx.select().from(tags).where(eq(tags.id, intoId));
    if (!from || !into) throw new UserFacingError("Essa etiqueta não existe mais.");
    if (isProtected(from.name)) throw new UserFacingError(`"${IMAGE_USE_TAG}" vem da importação do Avec: junte as outras nela, não ela nas outras.`);
    const moved = await tx.execute(sql`insert into contact_tags (contact_id, tag_id, created_by, created_at)
      select contact_id, ${intoId}::uuid, created_by, created_at from contact_tags where tag_id = ${fromId}::uuid on conflict do nothing`);
    await tx.delete(tags).where(eq(tags.id, fromId)); // as linhas de contact_tags da antiga saem junto (on delete cascade)
    await tx.insert(auditLog).values({ userId, action: "juntou_etiquetas", entity: "tag", entityId: intoId, data: { de: from.name, para: into.name, clientes: moved.rowCount ?? 0 } });
    return { moved: moved.rowCount ?? 0 };
  });
}
