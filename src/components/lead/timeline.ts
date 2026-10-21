import type { DealDetail } from "@/server/queries/deal";
import type { Msg } from "./conversation";

/** As mensagens do servidor no formato da conversa (o mesmo mapeamento na Fila e no Quadro). */
export const messagesToMsgs = (messages: DealDetail["messages"]): Msg[] => messages.map((m) => ({
  id: m.id, externalId: m.externalId, direction: m.direction, kind: m.kind, body: m.body, status: m.status, createdAt: new Date(m.createdAt).toISOString(),
  sender: m.sender, fromPhone: m.fromPhone, sentVia: m.sentVia, byId: m.sentByUserId ?? null, error: m.error, hasMedia: m.hasMedia, quotedBody: m.quotedBody,
  edited: !!m.editedAt, deleted: !!m.deletedAt, purgedAt: m.mediaPurgedAt ? new Date(m.mediaPurgedAt).toISOString() : undefined,
  reactions: m.reactions ?? null, call: m.call ?? null,
  importedAt: m.importedAt ? new Date(m.importedAt).toISOString() : undefined,
  durationSec: m.mediaDurationSec, hasPlayback: !!m.playbackPath, transcript: m.transcript, transcriptStatus: m.transcriptStatus,
}));

export type NoteLike = { id: string; body: string; authorName: string | null; createdAt: string | Date; source: string;
  /** Anotação de ligação (Lote 5): vai para dentro da linha da ligação. */ messageId?: string | null; subject?: string | null };

/** Nota interna como balão da conversa ("só a equipe vê"). Nunca conta como mensagem da Casa. */
export const noteToMsg = (n: NoteLike): Msg => ({
  id: `nota:${n.id}`, direction: "out", kind: "nota", body: n.body, status: "nota", createdAt: new Date(n.createdAt).toISOString(),
  sender: n.authorName, fromPhone: false, note: n.source === "chatguru" ? "chatguru" : n.source === "menu" ? "menu" : "crm",
});

/**
 * Mensagens e notas na ordem do relógio; no mesmo instante, a mensagem vem antes.
 * A anotação de uma ligação que está na lista entra dentro da linha da ligação (`callNotes`), não como balão solto.
 */
export function mergeTimeline(msgs: Msg[], notes: NoteLike[] = []): Msg[] {
  if (!notes.length) return msgs;
  const calls = new Set(msgs.filter((m) => m.kind === "call").map((m) => m.id));
  const linked = notes.filter((n) => n.messageId && calls.has(n.messageId));
  if (linked.length) {
    const byCall = new Map<string, NonNullable<Msg["callNotes"]>>();
    for (const n of linked) byCall.set(n.messageId!, [...(byCall.get(n.messageId!) ?? []),
      { id: n.id, subject: n.subject ?? null, body: n.body, authorName: n.authorName, createdAt: new Date(n.createdAt).toISOString() }]);
    msgs = msgs.map((m) => (byCall.has(m.id) ? { ...m, callNotes: byCall.get(m.id) } : m));
    notes = notes.filter((n) => !linked.includes(n));
    if (!notes.length) return msgs;
  }
  const all = [...msgs.map((m, i) => ({ m, i, n: 0 })), ...notes.map((x, i) => ({ m: noteToMsg(x), i, n: 1 }))];
  all.sort((a, b) => Date.parse(a.m.createdAt) - Date.parse(b.m.createdAt) || a.n - b.n || a.i - b.i);
  return all.map((x) => x.m);
}
