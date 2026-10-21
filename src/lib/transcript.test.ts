import { describe, expect, it } from "vitest";
import { transcriptText, type TranscriptLine } from "./transcript";

const lines: TranscriptLine[] = [
  { at: new Date("2026-10-15T17:02:00Z"), direction: "in", kind: "text", body: "Oi, quanto custa a escova?", author: null },
  { at: new Date("2026-10-15T17:05:00Z"), direction: "out", kind: "text", body: "*SARA - CASA FIAES:*\nA escova sai por R$ 80.", author: "Sara" },
  { at: new Date("2026-10-15T17:06:00Z"), direction: "nota", kind: "nota", body: "Cliente prefere sábado", author: "Sara" },
  { at: new Date("2026-10-15T17:07:00Z"), direction: "in", kind: "image", body: "foto do cabelo", author: null, deleted: true },
];
const base = { clientName: "Cliente Teste", phone: "(71) 99999-0091", generatedAt: new Date("2026-10-15T18:00:00Z"), generatedBy: "Thaíse", lines };

describe("conversa exportada em texto", () => {
  it("linhas legíveis no horário de Salvador, sem a assinatura crua, com o tipo de mídia e as marcas", () => {
    expect(transcriptText({ ...base, withNotes: false }).split("\n")).toEqual([
      "Conversa de Cliente Teste ((71) 99999-0091) com a Casa Fiaes",
      "Gerado em 15/10/2026 15:00 por Thaíse",
      "Período: 15/10/2026 14:02 a 15/10/2026 14:07 · 3 registros",
      "",
      "15/10/2026 14:02 · Cliente Teste (cliente): Oi, quanto custa a escova?",
      "15/10/2026 14:05 · Casa Fiaes (Sara): A escova sai por R$ 80.",
      "15/10/2026 14:07 · Cliente Teste (cliente): [Foto] foto do cabelo [apagada pela cliente]",
      "",
    ]);
  });
  it("notas internas só quando pedido, e o cabeçalho avisa", () => {
    const t = transcriptText({ ...base, withNotes: true });
    expect(t).toContain("15/10/2026 14:06 · Nota interna de Sara: Cliente prefere sábado");
    expect(t).toContain("inclui notas internas (só a equipe via)");
  });
  it("sem mensagens, diz isso", () => {
    expect(transcriptText({ ...base, lines: [], withNotes: false })).toContain("Nenhuma mensagem registrada.");
  });
  it("ligação sai com o texto dela (sem repetir o tipo)", () => {
    const call: TranscriptLine = { at: new Date("2026-10-15T17:10:00Z"), direction: "in", kind: "call", body: "Ligação recebida · atendida · 3 min", author: null };
    expect(transcriptText({ ...base, lines: [call], withNotes: false })).toContain("15/10/2026 14:10 · Cliente Teste (cliente): Ligação recebida · atendida · 3 min\n");
  });
});
