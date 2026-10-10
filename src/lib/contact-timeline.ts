import { groupByDay, historyEntries, type HistoryDay, type HistoryEntry, type HistoryEvent, type HistoryLookup } from "./history";

/** A linha do tempo da ficha do contato: mensagens, eventos dos leads (etapa, venda, tarefas, mudanças) e os leads que ficaram sem evento de criação. */
export type TimelineKind = "mensagem" | "evento" | "lead";
export type TimelineEntry = HistoryEntry & { kind: TimelineKind; /** Só mensagens: quem escreveu. */ direction?: "in" | "out" };
export type TimelineDay = HistoryDay<TimelineEntry>;

export type TimelineMessage = { id: string; direction: "in" | "out"; kind: string; body: string | null; createdAt: string | Date; sender: string | null; fromPhone: boolean; deleted: boolean };
export type TimelineDeal = { id: string; createdAt: string | Date; stageName: string };

const OFFSET_MS = 3 * 3_600_000; // America/Bahia
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (t: number) => { const d = new Date(t - OFFSET_MS); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const MEDIA: Record<string, string> = { image: "Foto", audio: "Áudio", video: "Vídeo", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem sem prévia" };
export const MESSAGE_CLIP = 220;

function messageEntry(m: TimelineMessage): TimelineEntry {
  const t = new Date(m.createdAt).getTime();
  const body = (m.body ?? "").replace(/\s+/g, " ").trim();
  const label = MEDIA[m.kind];
  const text = m.deleted ? "Mensagem apagada" : body ? (label && m.kind !== "text" ? `${label}: ${body}` : body) : label ?? "Mensagem";
  const who = m.direction === "in" ? "Cliente" : m.fromPhone ? "Casa, pelo celular" : m.sender?.trim().split(/\s+/)[0] ?? "Casa";
  return {
    id: `m:${m.id}`, at: new Date(t).toISOString(), kind: "mensagem", direction: m.direction, tone: "default",
    text: text.length > MESSAGE_CLIP ? `${text.slice(0, MESSAGE_CLIP - 1).trimEnd()}…` : text, meta: `${who}, ${hhmm(t)}`,
  };
}

/** Tudo junto, do mais novo ao mais antigo, agrupado por dia de Salvador ("Hoje", "Ontem", "sábado, 10 de outubro"). */
export function buildTimeline(input: { messages: TimelineMessage[]; events: (HistoryEvent & { dealId: string })[]; deals: TimelineDeal[]; lookup: HistoryLookup; now?: number }): TimelineDay[] {
  // Lead antigo, de antes da auditoria, pode não ter o evento de criação: ele entra como uma linha própria para não sumir da história.
  const withCreation = new Set(input.events.filter((e) => e.type === "lead_criado").map((e) => e.dealId));
  const leads: TimelineEntry[] = input.deals.filter((d) => !withCreation.has(d.id)).map((d) => {
    const t = new Date(d.createdAt).getTime();
    return { id: `l:${d.id}`, at: new Date(t).toISOString(), kind: "lead" as const, tone: "etapa" as const, text: `Lead criado (etapa atual: ${d.stageName})`, meta: hhmm(t) };
  });
  const events: TimelineEntry[] = historyEntries(input.events, input.lookup).map((e) => ({ ...e, kind: "evento" as const }));
  const msgs = input.messages.map(messageEntry);
  const all = [...events, ...leads, ...msgs].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return groupByDay(all, input.now ?? Date.now());
}
