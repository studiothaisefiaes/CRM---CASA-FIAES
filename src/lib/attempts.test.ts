import { describe, expect, it } from "vitest";
import type { BusinessHours } from "./business-hours";
import { attemptDueAt, attemptLabel, attemptTitle, isWaitingKind } from "./attempts";

/** Horário da Casa (Lote 0): terça a sábado, 9h às 18h. */
const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };

describe("attemptDueAt", () => {
  it("D+1 às 10h de Salvador", () => {
    expect(attemptDueAt(Date.parse("2026-10-13T13:00:00Z"), 1, CASA).toISOString()).toBe("2026-10-14T13:00:00.000Z");
  });
  it("noite de terça: D+1 é quarta (conta o dia de Salvador, não o de UTC)", () => {
    expect(attemptDueAt(Date.parse("2026-10-14T01:30:00Z"), 1, CASA).toISOString()).toBe("2026-10-14T13:00:00.000Z");
  });
  it("dia fechado passa para o próximo aberto: sábado + 1 → terça (domingo e segunda fechados)", () => {
    expect(attemptDueAt(Date.parse("2026-10-17T15:00:00Z"), 1, CASA).toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
  it("Casa que abre depois das 10h: vale a abertura", () => {
    expect(attemptDueAt(Date.parse("2026-10-13T13:00:00Z"), 1, { ...CASA, "3": ["11:30", "18:00"] }).toISOString()).toBe("2026-10-14T14:30:00.000Z");
  });
});

it("título, selo e tipos de espera", () => {
  expect(attemptTitle(1, "Rita Souza")).toBe("Tentativa 1 de 3: retomar contato com Rita");
  expect(attemptTitle(2, null)).toBe("Tentativa 2 de 3: retomar contato com a cliente");
  expect(attemptLabel(0)).toBeNull();
  expect(attemptLabel(2)).toBe("Tentativa 2/3");
  expect(attemptLabel(4)).toBe("3/3 · esperando a última resposta");
  expect(isWaitingKind("proposta")).toBe(true);
  expect(isWaitingKind("atendimento")).toBe(false);
});

it("nome no título do combinado: em Título, e telefone formatado (nunca o número cru)", async () => {
  const { clientFirstName, clientFullName } = await import("./attempts");
  expect(clientFirstName("THAMIRES SOUZA")).toBe("Thamires");
  expect(clientFirstName("+557190000002")).toBe("(71) 9000-0002");
  expect(clientFirstName("5571990000002")).toBe("(71) 99000-0002");
  expect(clientFirstName(null)).toBe("a cliente");
  expect(clientFullName("ÚRSULA DUARTE DOS SANTOS")).toBe("Úrsula Duarte dos Santos");
  expect(clientFullName("+5571990000002")).toBe("(71) 99000-0002");
  expect(clientFullName("  ")).toBe("a cliente");
});

describe("tentativas em Em conversa (nova organização, 16/10)", () => {
  it("Em conversa pode ter tentativas, mas só Orçamento começa ao entrar", async () => {
    const { isAttemptKind, ATTEMPT_DAYS } = await import("./attempts");
    expect(isAttemptKind("atendimento")).toBe(true);
    expect(isAttemptKind("proposta")).toBe(true);
    expect(isAttemptKind("agendado")).toBe(false);
    expect(isWaitingKind("atendimento")).toBe(false);
    expect(ATTEMPT_DAYS.atendimento).toEqual([1, 3, 7]);
  });

  it("linha da Fila: 'Tentativa 2 de 3 · vira Perdido sex'", async () => {
    const { attemptLine } = await import("./attempts");
    expect(attemptLine(2, "sex")).toBe("Tentativa 2 de 3 · vira Perdido sex");
    expect(attemptLine(4, "amanhã")).toBe("3 tentativas feitas · vira Perdido amanhã");
    expect(attemptLine(1, null)).toBe("Tentativa 1 de 3");
    expect(attemptLine(0, "sex")).toBeNull();
  });

  it("previsão do Perdido: 3ª tentativa prevista + 2 dias; com as 3 feitas, a data guardada", async () => {
    const { projectedLostAt } = await import("./attempts");
    const start = Date.parse("2026-10-13T13:00:00Z"); // terça
    // tentativa 1: 3ª prevista em D+7 (terça 20/10), +2 dias de expediente = quinta 22/10 10h
    expect(projectedLostAt({ attempt: 1, dueMs: Date.parse("2026-10-14T13:00:00Z"), startedMs: start, days: [1, 3, 7] }, CASA)?.toISOString()).toBe("2026-10-22T13:00:00.000Z");
    // a 3ª foi remarcada para sexta 23/10: conta a data dela
    expect(projectedLostAt({ attempt: 3, dueMs: Date.parse("2026-10-23T13:00:00Z"), startedMs: start, days: [1, 3, 7] }, CASA)?.toISOString()).toBe("2026-10-27T13:00:00.000Z");
    expect(projectedLostAt({ attempt: 4, dueMs: Date.parse("2026-10-22T13:00:00Z"), startedMs: start, days: [1, 3, 7] }, CASA)?.toISOString()).toBe("2026-10-22T13:00:00.000Z");
    expect(projectedLostAt({ attempt: 0, dueMs: null, startedMs: start, days: [1, 3, 7] }, CASA)).toBeNull();
  });
});
