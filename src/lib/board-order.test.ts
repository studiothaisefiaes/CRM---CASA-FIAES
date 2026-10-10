import { describe, expect, it } from "vitest";
import { boardUrgency, compareUrgency, orderByUrgency, type UrgencyCard } from "./board-order";

const card = (id: string, over: Partial<UrgencyCard> = {}): UrgencyCard => ({ id, urgency: "idle", waitSeconds: 0, lastMessageAt: null, stageEnteredAt: "2026-10-01T10:00:00Z", ...over });

describe("boardUrgency", () => {
  it("atrasado (alerta aberto) vence tudo, mesmo sem prazo ou sem espera", () => {
    expect(boardUrgency({ late: true, awaiting: false, waitSeconds: 0, slaMinutes: null })).toBe("late");
  });
  it("perto do prazo a partir de metade do prazo da etapa", () => {
    expect(boardUrgency({ late: false, awaiting: true, waitSeconds: 60, slaMinutes: 2 })).toBe("near");
    expect(boardUrgency({ late: false, awaiting: true, waitSeconds: 119, slaMinutes: 4 })).toBe("waiting");
  });
  it("esperando sem prazo na etapa é 'aguardando'; sem espera é 'idle' (a bola está com a cliente)", () => {
    expect(boardUrgency({ late: false, awaiting: true, waitSeconds: 9999, slaMinutes: null })).toBe("waiting");
    expect(boardUrgency({ late: false, awaiting: false, waitSeconds: 0, slaMinutes: 5 })).toBe("idle");
  });
});

describe("orderByUrgency", () => {
  it("atrasado, depois perto do prazo, depois aguardando, depois o resto; dentro do grupo, quem espera há mais tempo primeiro", () => {
    const cards = [
      card("idle-novo", { lastMessageAt: "2026-10-09T12:00:00Z" }),
      card("espera-curta", { urgency: "waiting", waitSeconds: 10 }),
      card("perto", { urgency: "near", waitSeconds: 70 }),
      card("atrasado-curto", { urgency: "late", waitSeconds: 130 }),
      card("espera-longa", { urgency: "waiting", waitSeconds: 50 }),
      card("atrasado-longo", { urgency: "late", waitSeconds: 900 }),
      card("idle-velho", { lastMessageAt: "2026-10-01T12:00:00Z" }),
    ];
    expect(orderByUrgency(cards).map((c) => c.id)).toEqual(["atrasado-longo", "atrasado-curto", "perto", "espera-longa", "espera-curta", "idle-novo", "idle-velho"]);
  });
  it("não muda a lista original e desempata pelo id (ordem estável)", () => {
    const cards = [card("b"), card("a")];
    expect(orderByUrgency(cards).map((c) => c.id)).toEqual(["a", "b"]);
    expect(cards.map((c) => c.id)).toEqual(["b", "a"]);
    expect(compareUrgency(card("a"), card("a"))).toBe(0);
  });
});
