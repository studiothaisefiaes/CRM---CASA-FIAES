import { db } from "../db";
import { auditLog } from "../db/schema";
import { loadTranscript } from "../queries/transcript";
import { transcriptText } from "@/lib/transcript";

const OFFSET_MS = 3 * 3_600_000;
const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "cliente";
const day = (d: Date) => new Date(d.getTime() - OFFSET_MS).toISOString().slice(0, 10);

/** Conversa em texto (pedido da cliente pela LGPD ou para guardar). Fica registrado quem exportou e se levou as notas. */
export async function exportConversationText(contactId: string, user: { id: string; name: string }, opts: { notes: boolean }, now = new Date()): Promise<{ filename: string; body: string } | null> {
  const t = await loadTranscript(contactId, opts);
  if (!t) return null;
  await db.insert(auditLog).values({ userId: user.id, action: "exportou", entity: "conversa", entityId: contactId, data: { formato: "texto", notas: opts.notes, registros: t.lines.length } });
  return {
    filename: `conversa-${slug(t.clientName)}-${day(now)}.txt`,
    body: transcriptText({ clientName: t.clientName, phone: t.phone, generatedAt: now, generatedBy: user.name, lines: t.lines, withNotes: opts.notes, truncated: t.truncated }),
  };
}

/** O PDF sai da página /imprimir/conversa; aqui ficam o registro de quem exportou e o nome do arquivo. */
export async function logConversationPdf(contactId: string, user: { id: string }, notes: boolean, now = new Date()): Promise<{ filename: string } | null> {
  const t = await loadTranscript(contactId, { notes: false });
  if (!t) return null;
  await db.insert(auditLog).values({ userId: user.id, action: "exportou", entity: "conversa", entityId: contactId, data: { formato: "pdf", notas: notes, registros: t.lines.length } });
  return { filename: `conversa-${slug(t.clientName)}-${day(now)}.pdf` };
}
