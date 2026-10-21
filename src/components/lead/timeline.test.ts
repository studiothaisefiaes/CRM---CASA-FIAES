import { describe, expect, it } from "vitest";
import { mergeTimeline, noteToMsg } from "./timeline";
import { withDays, type Msg } from "./conversation";

const msg = (id: string, at: string, over: Partial<Msg> = {}): Msg => ({ id, direction: "out", kind: "text", body: id, status: "sent", createdAt: at, sender: "Sara", fromPhone: false, ...over });

describe("notas na conversa", () => {
  it("entram pela hora; no mesmo instante, a mensagem vem antes", () => {
    const t = mergeTimeline([msg("a", "2026-10-15T13:00:00.000Z"), msg("b", "2026-10-15T13:05:00.000Z")],
      [{ id: "n1", body: "nota", authorName: "Cati", createdAt: "2026-10-15T13:00:00.000Z", source: "crm" }]);
    expect(t.map((m) => m.id)).toEqual(["a", "nota:n1", "b"]);
  });
  it("nota vira balão próprio: tipo nota, de quem escreveu, de onde veio", () => {
    expect(noteToMsg({ id: "n2", body: "x", authorName: "SARA", createdAt: new Date("2026-10-15T13:00:00Z"), source: "chatguru" }))
      .toMatchObject({ id: "nota:n2", kind: "nota", sender: "SARA", note: "chatguru", status: "nota" });
  });
  it("nota nunca gruda no balão da Casa (nem o balão da Casa nela)", () => {
    const rows = withDays(mergeTimeline([msg("a", "2026-10-15T13:00:00.000Z"), msg("b", "2026-10-15T13:02:00.000Z")],
      [{ id: "n1", body: "nota", authorName: "Sara", createdAt: "2026-10-15T13:01:00.000Z", source: "crm" }]));
    expect(rows.map((r) => r.cont)).toEqual([false, false, false]);
  });
});

describe("anotação de ligação (Lote 5)", () => {
  it("a nota ligada à ligação vai para dentro da linha da ligação (não vira balão solto)", () => {
    const call = msg("c1", "2026-10-15T13:00:00.000Z", { kind: "call", direction: "in", body: "Ligação recebida · atendida" });
    const t = mergeTimeline([call], [
      { id: "n1", body: "marcou corte sábado", subject: "Agendamento", messageId: "c1", authorName: "Sara", createdAt: "2026-10-15T13:05:00.000Z", source: "crm" },
      { id: "n2", body: "nota solta", authorName: "Cati", createdAt: "2026-10-15T13:06:00.000Z", source: "crm" },
    ]);
    expect(t.map((m) => m.id)).toEqual(["c1", "nota:n2"]);
    expect(t[0].callNotes).toEqual([{ id: "n1", subject: "Agendamento", body: "marcou corte sábado", authorName: "Sara", createdAt: "2026-10-15T13:05:00.000Z" }]);
  });
  it("ligação fora da lista (outra conversa): a nota aparece como balão", () => {
    const t = mergeTimeline([], [{ id: "n1", body: "x", messageId: "sumiu", authorName: "Sara", createdAt: "2026-10-15T13:05:00.000Z", source: "crm" }]);
    expect(t.map((m) => m.id)).toEqual(["nota:n1"]);
  });
});
