import { describe, expect, it } from "vitest";
import { BLOCK_REASON_LABEL, BLOCK_REASONS, blockAppliesOn, clientsInsideText, reasonFromTitle } from "./agenda-blocks";

describe("blockAppliesOn", () => {
  const almoco = { startsOn: "2026-10-01", endsOn: "2026-12-31", weekdays: [2] };
  it("vale só nos dias da semana pedidos, dentro do intervalo", () => {
    expect(blockAppliesOn(almoco, "2026-10-13")).toBe(true); // terça
    expect(blockAppliesOn(almoco, "2026-10-14")).toBe(false); // quarta
    expect(blockAppliesOn(almoco, "2027-01-05")).toBe(false); // terça, fora do intervalo
  });
  it("sem dias da semana: todos os dias do intervalo", () => {
    expect(blockAppliesOn({ startsOn: "2026-10-15", endsOn: "2026-10-15", weekdays: null }, "2026-10-15")).toBe(true);
    expect(blockAppliesOn({ startsOn: "2026-10-15", endsOn: "2026-10-15", weekdays: null }, "2026-10-16")).toBe(false);
  });
});

describe("motivos e clientes dentro do bloqueio (Lote 6A)", () => {
  it("motivos fixos, com o nome da tela", () => {
    expect(BLOCK_REASONS.map((r) => BLOCK_REASON_LABEL[r])).toEqual(["Almoço", "Folga", "Atestado", "Feriado", "Curso", "Outro"]);
  });
  it("bloqueio do Avec abre no motivo que o título diz; o resto vira Outro com o título", () => {
    expect(reasonFromTitle("ALMOÇO")).toEqual({ reason: "almoco", note: null });
    expect(reasonFromTitle("Folga")).toEqual({ reason: "folga", note: null });
    expect(reasonFromTitle("Reunião de equipe")).toEqual({ reason: "outro", note: "Reunião de equipe" });
  });
  it("lista quem está marcado dentro, com o dia quando o bloqueio pega mais de um", () => {
    // 13:00Z = 10:00 em Salvador.
    expect(clientsInsideText([
      { name: "Paula Souza", startsAt: "2026-10-16T13:00:00.000Z", professionalName: "Ana" },
      { name: "Rita", startsAt: "2026-10-16T14:00:00.000Z", professionalName: "Ana" },
      { name: "Lia Melo", startsAt: "2026-10-16T17:00:00.000Z", professionalName: null },
    ])).toBe("3 clientes marcadas: Paula 10:00, Rita 11:00, Lia 14:00");
    expect(clientsInsideText([{ name: "Paula", startsAt: "2026-10-16T13:00:00.000Z", professionalName: "Ana" }])).toBe("1 cliente marcada: Paula 10:00");
    expect(clientsInsideText([
      { name: "Paula", startsAt: "2026-10-16T13:00:00.000Z", professionalName: "Ana" }, { name: "Rita", startsAt: "2026-10-17T12:00:00.000Z", professionalName: "Ana" },
    ])).toBe("2 clientes marcadas: Paula 16/10 10:00, Rita 17/10 09:00");
    expect(clientsInsideText([])).toBe("");
  });
  it("muitas clientes: mostra 5 e diz quantas faltam", () => {
    const list = Array.from({ length: 7 }, (_, i) => ({ name: `C${i}`, startsAt: `2026-10-16T1${i}:00:00.000Z`, professionalName: null }));
    expect(clientsInsideText(list)).toBe("7 clientes marcadas: C0 07:00, C1 08:00, C2 09:00, C3 10:00, C4 11:00 e mais 2");
  });
});

