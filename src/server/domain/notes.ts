import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contactNotes, contacts, deals, messages, users } from "../db/schema";
import { alertText, clientLabel } from "@/lib/alert-copy";
import { teamNameCol } from "../queries/team-name";
import { emit } from "./events";
import { UserFacingError } from "./errors";

export const NOTE_MAX = 2000;
export const NOTE_SUBJECT_MAX = 120;
export type NoteItem = { id: string; body: string; authorName: string | null; createdAt: Date; mentions: string[]; source: string;
  /** "Anotar o que foi falado" (Lote 5): a ligação a que a nota se refere e o assunto. */
  messageId: string | null; subject: string | null };

/** Trecho da nota no aviso do sino: uma linha, até 80 caracteres. */
export const noteExcerpt = (body: string) => {
  const one = body.replace(/\s+/g, " ").trim();
  return one.length > 80 ? `${one.slice(0, 79)}…` : one;
};

/**
 * Nota interna na conversa. A cliente nunca vê: não passa pelo WhatsApp, não conta como resposta, não mexe na espera nem na etapa.
 * `mentions`: ids da equipe chamados com @. Só quem está ativo recebe o aviso "te marcou numa nota" (sino e push); a autora nunca.
 */
export async function addNote(input: { dealId: string; body: string; mentions?: string[]; subject?: string | null; messageId?: string | null }, authorId: string, now = new Date()): Promise<{ id: string; notified: number }> {
  const body = input.body.trim();
  const subject = input.subject?.trim() || null;
  if (!body) throw new UserFacingError("Escreva a nota antes de salvar.");
  if (body.length > NOTE_MAX) throw new UserFacingError(`Nota muito longa (máximo ${NOTE_MAX.toLocaleString("pt-BR")} caracteres).`);
  if (subject && subject.length > NOTE_SUBJECT_MAX) throw new UserFacingError(`Assunto muito longo (máximo ${NOTE_SUBJECT_MAX} caracteres).`);
  const [row] = await db.select({ contactId: deals.contactId, name: contacts.name, phone: contacts.phoneE164 })
    .from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(deals.id, input.dealId));
  if (!row) throw new UserFacingError("Essa conversa não existe mais.");
  // Anotação de ligação: só numa ligação desta cliente.
  if (input.messageId) {
    const [call] = await db.select({ id: messages.id }).from(messages)
      .where(and(eq(messages.id, input.messageId), eq(messages.contactId, row.contactId), eq(messages.kind, "call")));
    if (!call) throw new UserFacingError("Essa ligação não é desta conversa.");
  }
  const wanted = [...new Set(input.mentions ?? [])].filter((id) => id !== authorId);
  const mentioned = wanted.length
    ? (await db.select({ id: users.id }).from(users).where(and(inArray(users.id, wanted), eq(users.active, true)))).map((u) => u.id)
    : [];
  const [author] = await db.select({ name: users.name }).from(users).where(eq(users.id, authorId));
  const client = clientLabel(row.name, row.phone);
  const result = await db.transaction(async (tx) => {
    const [note] = await tx.insert(contactNotes)
      .values({ contactId: row.contactId, dealId: input.dealId, authorId, body, mentions: mentioned, createdAt: now, subject, messageId: input.messageId ?? null }).returning({ id: contactNotes.id });
    // Anotou a ligação: o lembrete "Anote a ligação" some.
    if (input.messageId) await tx.update(alerts).set({ resolvedAt: now, readAt: sql`coalesce(${alerts.readAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(alerts.dedupeKey, `ligacao:${input.messageId}`), isNull(alerts.resolvedAt)));
    for (const uid of mentioned) {
      await tx.insert(alerts).values({
        dealId: input.dealId, userId: uid, audience: "responsavel", type: "mencao", severity: "info", createdAt: now,
        message: alertText.mention(author?.name ?? null, client, noteExcerpt(body)), dedupeKey: `mencao:${note.id}:${uid}`,
      }).onConflictDoNothing();
    }
    return { id: note.id, notified: mentioned.length };
  });
  await emit("nota_criada", { dealId: input.dealId });
  // Anotação de ligação: a prévia da Fila ("Ligação 3 min · marcou corte sábado") muda junto.
  if (input.messageId) await emit("mensagem_atualizada", { dealId: input.dealId });
  if (result.notified) await emit("alerta", { dealId: input.dealId });
  return result;
}

/** As notas da cliente (todas as conversas dela), da mais antiga para a mais nova, com o nome de quem escreveu (como na equipe). */
export async function notesOf(contactId: string, limit = 200): Promise<NoteItem[]> {
  const rows = await db.select({
    id: contactNotes.id, body: contactNotes.body, team: teamNameCol(), authorName: contactNotes.authorName,
    createdAt: contactNotes.createdAt, mentions: contactNotes.mentions, source: contactNotes.source, messageId: contactNotes.messageId, subject: contactNotes.subject,
  }).from(contactNotes).leftJoin(users, eq(users.id, contactNotes.authorId))
    .where(eq(contactNotes.contactId, contactId)).orderBy(desc(contactNotes.createdAt), desc(contactNotes.id)).limit(limit);
  return rows.reverse().map((r) => ({ id: r.id, body: r.body, authorName: r.team ?? r.authorName ?? null, createdAt: r.createdAt, mentions: r.mentions, source: r.source, messageId: r.messageId, subject: r.subject }));
}
