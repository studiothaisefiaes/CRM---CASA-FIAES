import { stripSignature } from "./signature";

/** Uma linha da conversa exportada (LGPD): mensagem da cliente, da Casa ou nota interna. */
export type TranscriptLine = { at: Date; direction: "in" | "out" | "nota"; kind: string; body: string | null; author: string | null; deleted?: boolean; edited?: boolean };
const OFFSET_MS = 3 * 3_600_000;
const pad = (n: number) => String(n).padStart(2, "0");
/** "15/10/2026 14:02" no horário de Salvador. */
export const stamp = (d: Date) => { const x = new Date(d.getTime() - OFFSET_MS); return `${pad(x.getUTCDate())}/${pad(x.getUTCMonth() + 1)}/${x.getUTCFullYear()} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}`; };
const KIND: Record<string, string> = { image: "Foto", video: "Vídeo", audio: "Áudio", document: "Documento", sticker: "Figurinha", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", call: "Ligação", other: "Mensagem sem prévia" };

export function transcriptLine(l: TranscriptLine, clientName: string): string {
  const who = l.direction === "in" ? `${clientName} (cliente)` : l.direction === "nota" ? `Nota interna de ${l.author ?? "alguém da equipe"}` : `Casa Fiaes${l.author ? ` (${l.author})` : ""}`;
  const text = (l.direction === "out" ? stripSignature(l.body) : l.body ?? "").trim();
  // Ligação já diz o que foi no texto ("Ligação perdida"): o tipo só aparece quando não há texto.
  const label = l.kind !== "text" && l.kind !== "nota" && !(l.kind === "call" && text) ? `[${KIND[l.kind] ?? "Mensagem"}]` : "";
  const flags = `${l.deleted ? " [apagada pela cliente]" : ""}${l.edited ? " [editada]" : ""}`;
  return `${stamp(l.at)} · ${who}: ${[label, text].filter(Boolean).join(" ")}${flags}`;
}

export function transcriptText(input: { clientName: string; phone: string; generatedAt: Date; generatedBy: string; lines: TranscriptLine[]; withNotes: boolean; truncated?: boolean }): string {
  const lines = input.lines.filter((l) => input.withNotes || l.direction !== "nota");
  const head = [
    `Conversa de ${input.clientName} (${input.phone}) com a Casa Fiaes`,
    `Gerado em ${stamp(input.generatedAt)} por ${input.generatedBy}${input.withNotes ? " · inclui notas internas (só a equipe via)" : ""}`,
    lines.length
      ? `Período: ${stamp(lines[0].at)} a ${stamp(lines[lines.length - 1].at)} · ${lines.length} registro${lines.length === 1 ? "" : "s"}${input.truncated ? " (só os 20.000 primeiros)" : ""}`
      : "Nenhuma mensagem registrada.",
    "",
  ];
  return [...head, ...lines.map((l) => transcriptLine(l, input.clientName))].join("\n") + "\n";
}
