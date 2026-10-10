import { describe, it, expect } from "vitest";
import { buildTimeline } from "./contact-timeline";

const lookup = { users: {}, lists: {}, sources: {}, stages: { atendimento: "Atendimento" } };
const NOW = Date.parse("2026-10-10T15:00:00Z");

describe("buildTimeline", () => {
  it("junta mensagens, eventos e leads, do mais novo ao mais antigo, agrupados por dia de Salvador", () => {
    const days = buildTimeline({
      now: NOW, lookup,
      messages: [
        { id: "m1", direction: "in", kind: "text", body: "Oi, quero progressiva", createdAt: "2026-10-10T12:00:00Z", sender: null, fromPhone: false, deleted: false },
        { id: "m2", direction: "out", kind: "text", body: "Claro!", createdAt: "2026-10-09T12:00:00Z", sender: "Ana Souza", fromPhone: false, deleted: false },
      ],
      events: [{ id: "e1", dealId: "d1", type: "lead_criado", payload: { origin: "Instagram" }, createdAt: "2026-10-10T11:59:00Z", user: null }],
      deals: [{ id: "d1", createdAt: "2026-10-10T11:59:00Z", stageName: "Lead" }, { id: "d0", createdAt: "2026-08-01T12:00:00Z", stageName: "Fechado" }],
    });
    expect(days.map((d) => d.label)).toEqual(["Hoje", "Ontem", "sábado, 1 de agosto"]);
    expect(days[0].entries.map((e) => e.kind)).toEqual(["mensagem", "evento"]);
    expect(days[0].entries[0].meta).toBe("Cliente, 09:00"); // 12:00Z = 09:00 em Salvador
    expect(days[1].entries[0].meta).toBe("Ana, 09:00");
    expect(days[2].entries[0]).toMatchObject({ kind: "lead", text: "Lead criado (etapa atual: Fechado)" });
  });

  it("mídia sem texto e mensagem apagada viram rótulos; texto longo é cortado", () => {
    const [day] = buildTimeline({
      now: NOW, lookup, events: [], deals: [],
      messages: [
        { id: "a", direction: "in", kind: "image", body: null, createdAt: "2026-10-10T12:03:00Z", sender: null, fromPhone: false, deleted: false },
        { id: "b", direction: "in", kind: "text", body: "segredo", createdAt: "2026-10-10T12:02:00Z", sender: null, fromPhone: false, deleted: true },
        { id: "c", direction: "out", kind: "text", body: "x".repeat(500), createdAt: "2026-10-10T12:01:00Z", sender: null, fromPhone: true, deleted: false },
      ],
    });
    expect(day.entries.map((e) => e.text.length > 100 ? "longa" : e.text)).toEqual(["Foto", "Mensagem apagada", "longa"]);
    expect(day.entries[2].text.endsWith("…")).toBe(true);
    expect(day.entries[2].meta).toBe("Casa, pelo celular, 09:01");
  });
});
