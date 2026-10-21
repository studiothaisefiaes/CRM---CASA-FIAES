import { describe, expect, it } from "vitest";
import { historyEntries, type HistoryLookup } from "./history";

const lookup: HistoryLookup = { users: {}, lists: {}, sources: {} };
const ev = (type: string, payload: Record<string, unknown> = {}) => ({ id: type, type, payload, createdAt: "2026-10-20T13:00:00Z", user: "Sara Lima" });
const text = (type: string, payload?: Record<string, unknown>) => historyEntries([ev(type, payload)], lookup)[0].text;

describe("histórico do Lote 5", () => {
  it("mensagem agendada e cancelada", () => {
    expect(text("mensagem_agendada", { para: "2026-10-21T13:00:00.000Z" })).toBe("Mensagem agendada para amanhã 10:00");
    expect(text("agendada_cancelada")).toBe("Mensagem agendada cancelada");
  });
  it("resolvida e desfeita", () => {
    expect(text("resolvida", { desde: "2026-10-20T12:00:00.000Z" })).toBe("Resolvida sem resposta (não precisava responder)");
    expect(text("resolvida_desfeita")).toBe("“Resolvida” desfeita: voltou a esperar resposta");
  });
});
