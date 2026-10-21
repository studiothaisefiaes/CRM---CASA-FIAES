// src/lib/team-now.test.ts
import { describe, expect, it } from "vitest";
import { lastReplyLabel, teamState } from "./team-now";

const NOW = new Date("2026-10-15T15:00:00Z"); // 12:00 em Salvador
const minAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("teamState", () => {
  it("pausa vale sobre tudo; resposta recente (até pelo celular) é 'respondendo'; batida recente é CRM aberto", () => {
    expect(teamState({ availability: "pausa", lastSeenAt: minAgo(1), lastReplyAt: minAgo(1) }, NOW)).toBe("pausa");
    expect(teamState({ availability: "ausente", lastSeenAt: null, lastReplyAt: minAgo(10) }, NOW)).toBe("respondendo");
    expect(teamState({ availability: "disponivel", lastSeenAt: minAgo(2), lastReplyAt: minAgo(20) }, NOW)).toBe("no_crm");
    expect(teamState({ availability: "ausente", lastSeenAt: minAgo(30), lastReplyAt: null }, NOW)).toBe("sem_sinal");
  });
});

describe("lastReplyLabel", () => {
  it("diz quando e por onde", () => {
    expect(lastReplyLabel(minAgo(4), "celular", NOW)).toBe("há 4 min, pelo celular");
    expect(lastReplyLabel(new Date(NOW.getTime() - 30_000), "crm", NOW)).toBe("agora, pelo CRM");
    expect(lastReplyLabel(new Date("2026-10-15T12:12:00Z"), "crm", NOW)).toBe("hoje 09:12, pelo CRM");
    expect(lastReplyLabel(new Date("2026-10-14T16:15:00Z"), "celular", NOW)).toBe("ontem 13:15, pelo celular");
    expect(lastReplyLabel(new Date("2026-10-12T20:40:00Z"), "crm", NOW)).toBe("12/10 17:40, pelo CRM");
    expect(lastReplyLabel(null, null, NOW)).toBe("nenhuma resposta nos últimos 7 dias");
  });
});
