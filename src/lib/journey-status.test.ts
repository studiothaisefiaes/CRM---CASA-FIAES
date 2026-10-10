import { describe, expect, it } from "vitest";
import { agoLabel, personStatus, scheduleLabel, type StatusInput } from "./journey-status";
import { DEFAULT_HOURS } from "./business-hours";

// Quarta-feira 15:00 em Salvador (18:00Z), dentro do expediente padrão.
const NOW = new Date("2026-10-07T18:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000, H = 3_600_000, D = 86_400_000;
const base: StatusInput = { stageKind: "lead", awaitingSince: null, urgency: "idle", slaMinutes: 2, scheduledAt: null, closedAt: null };
const status = (over: Partial<StatusInput>) => personStatus({ ...base, ...over }, NOW, DEFAULT_HOURS);

describe("agoLabel", () => {
  it("dias, horas e minutos, no singular quando é 1", () => {
    expect(agoLabel(3 * D)).toBe("há 3 dias");
    expect(agoLabel(1 * D + 2 * H)).toBe("há 1 dia");
    expect(agoLabel(5 * H)).toBe("há 5 h");
    expect(agoLabel(10 * MIN)).toBe("há 10 min");
    expect(agoLabel(20_000)).toBe("agora");
    expect(agoLabel(-5000)).toBe("agora");
  });
});

describe("scheduleLabel (fuso America/Bahia)", () => {
  it("dia da semana abreviado e hora, com minutos só quando não é hora cheia", () => {
    expect(scheduleLabel("2026-10-13T18:00:00Z", NOW)).toBe("ter 15h");
    expect(scheduleLabel("2026-10-13T18:30:00Z", NOW)).toBe("ter 15h30");
  });
  it("hoje e amanhã dizem hoje e amanhã", () => {
    expect(scheduleLabel("2026-10-07T20:00:00Z", NOW)).toBe("hoje 17h");
    expect(scheduleLabel("2026-10-08T13:00:00Z", NOW)).toBe("amanhã 10h");
  });
  it("lê o dia em Salvador, não em UTC", () => {
    expect(scheduleLabel("2026-10-13T01:00:00Z", NOW)).toBe("seg 22h"); // 22h de segunda em Salvador, já terça em UTC
  });
  it("mais de uma semana adiante vira dia/mês", () => {
    expect(scheduleLabel("2026-10-20T18:00:00Z", NOW)).toBe("20/10 15h");
  });
});

describe("personStatus", () => {
  it("fechado e perdido dizem há quanto tempo, sem anel de prazo", () => {
    expect(status({ stageKind: "fechado", closedAt: ago(3 * D) })).toEqual({ text: "fechou há 3 dias", ring: "none", progress: 0 });
    expect(status({ stageKind: "perdido", closedAt: ago(2 * D) })).toEqual({ text: "perdido há 2 dias", ring: "none", progress: 0 });
    expect(status({ stageKind: "perdido", closedAt: ago(1 * D) }).text).toBe("perdido há 1 dia");
    // mesmo com espera registrada, o prazo não vale para quem já terminou
    expect(status({ stageKind: "fechado", closedAt: ago(D), awaitingSince: ago(10 * MIN), urgency: "late" }).ring).toBe("none");
  });
  it("agendado mostra o horário marcado", () => {
    expect(status({ stageKind: "agendado", scheduledAt: "2026-10-13T18:00:00Z" }).text).toBe("agendado para ter 15h");
    expect(status({ stageKind: "agendado", scheduledAt: null }).text).toBe("agendado");
  });
  it("agendado em que a cliente espera resposta mostra a espera, que é o que pede ação", () => {
    const s = status({ stageKind: "agendado", scheduledAt: "2026-10-13T18:00:00Z", awaitingSince: ago(11 * MIN), urgency: "late" });
    expect(s).toMatchObject({ text: "atrasado · 11 min", ring: "late", progress: 1 });
  });
  it("lead, atendimento e follow-up sem espera: com a cliente", () => {
    for (const stageKind of ["lead", "atendimento", "followup"]) expect(status({ stageKind })).toEqual({ text: "com a cliente", ring: "none", progress: 0 });
  });
  it("com espera: tempo e anel do prazo da etapa", () => {
    expect(status({ awaitingSince: ago(75_000) })).toMatchObject({ text: "1 min 15 s", ring: "near" });
    expect(status({ awaitingSince: ago(15_000) })).toMatchObject({ text: "15 s", ring: "ok" });
    expect(status({ awaitingSince: ago(75_000) }).progress).toBeCloseTo(0.625, 2);
  });
});
