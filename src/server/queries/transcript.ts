import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { contactNotes, contacts, messages, users } from "../db/schema";
import { teamNameCol } from "./team-name";
import { parseSignature, signatureDisplayName } from "@/lib/signature";
import { formatPhoneClient, nameFallback } from "@/lib/phone-client";
import type { TranscriptLine } from "@/lib/transcript";

export const TRANSCRIPT_MAX = 20_000;

/** Toda a conversa da cliente (todas as conversas dela, pelo número), da mais antiga para a mais nova; notas só se pedido. */
export async function loadTranscript(contactId: string, opts: { notes: boolean }): Promise<{ clientName: string; phone: string; lines: TranscriptLine[]; truncated: boolean } | null> {
  const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
  if (!c) return null;
  const rows = await db.select({ at: messages.createdAt, direction: messages.direction, kind: messages.kind, body: messages.body, team: teamNameCol(), deleted: messages.deletedAt, edited: messages.editedAt })
    .from(messages).leftJoin(users, eq(users.id, messages.sentByUserId))
    .where(eq(messages.contactId, contactId)).orderBy(asc(messages.createdAt), asc(messages.id)).limit(TRANSCRIPT_MAX + 1);
  const lines: TranscriptLine[] = rows.slice(0, TRANSCRIPT_MAX).map((r) => ({
    at: r.at, direction: r.direction, kind: r.kind, body: r.body, deleted: !!r.deleted, edited: !!r.edited,
    author: r.direction === "out" ? r.team ?? signatureDisplayName(parseSignature(r.body)) : null,
  }));
  if (opts.notes) {
    const notes = await db.select({ at: contactNotes.createdAt, body: contactNotes.body, subject: contactNotes.subject, team: teamNameCol(), authorName: contactNotes.authorName })
      .from(contactNotes).leftJoin(users, eq(users.id, contactNotes.authorId)).where(eq(contactNotes.contactId, contactId)).orderBy(asc(contactNotes.createdAt));
    lines.push(...notes.map((n) => ({ at: n.at, direction: "nota" as const, kind: "nota", body: n.subject ? `${n.subject} — ${n.body}` : n.body, author: n.team ?? n.authorName ?? null })));
    lines.sort((a, b) => a.at.getTime() - b.at.getTime());
  }
  return { clientName: c.name?.trim() || nameFallback(c.phoneE164), phone: formatPhoneClient(c.phoneE164), lines, truncated: rows.length > TRANSCRIPT_MAX };
}
