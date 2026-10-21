import { describe, it, expect } from "vitest";
import { AUTOMATION_TEMPLATES, sendsMessages } from "./templates";
import { automationInputSchema } from "./types";

describe("modelos de automação", () => {
  it("são 6, com id único, nome e descrição (Plano 5: saíram os dois do lembrete da véspera)", () => {
    expect(AUTOMATION_TEMPLATES).toHaveLength(6);
    expect(new Set(AUTOMATION_TEMPLATES.map((t) => t.id)).size).toBe(6);
    for (const t of AUTOMATION_TEMPLATES) { expect(t.name.length).toBeGreaterThan(5); expect(t.description.length).toBeGreaterThan(20); }
  });
  it("todo modelo passa no automationSchema", () => {
    for (const t of AUTOMATION_TEMPLATES) expect(automationInputSchema.safeParse(t.rule).success, t.id).toBe(true);
  });
  it("todo modelo que envia mensagem vem desligado (e nenhum liga sozinho)", () => {
    const senders = AUTOMATION_TEMPLATES.filter((t) => sendsMessages(t.rule.actions));
    expect(senders.length).toBeGreaterThan(0);
    for (const t of AUTOMATION_TEMPLATES) expect(t.rule.enabled, t.id).toBe(false);
  });
  it("o lembrete em texto e a enquete D-1 não vêm juntos na mesma automação", () => {
    for (const t of AUTOMATION_TEMPLATES) {
      const types = t.rule.actions.map((a) => a.type);
      expect(types.includes("enviar_mensagem") && types.includes("enviar_enquete_confirmacao"), t.id).toBe(false);
    }
  });
});
