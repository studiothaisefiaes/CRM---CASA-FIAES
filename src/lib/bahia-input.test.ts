import { describe, expect, it } from "vitest";
import { bahiaDateInput, bahiaTimeInput, fromBahiaInputs } from "./bahia-input";

describe("data e hora de Salvador nos campos", () => {
  it("dia e hora digitados viram o instante certo (UTC-3)", () => {
    expect(fromBahiaInputs("2026-10-21", "10:00")?.toISOString()).toBe("2026-10-21T13:00:00.000Z");
  });
  it("campo vazio ou torto vira null", () => {
    expect(fromBahiaInputs("", "10:00")).toBeNull();
    expect(fromBahiaInputs("2026-10-21", "25:99")).toBeNull();
  });
  it("23h em Salvador ainda é o mesmo dia", () => {
    const ms = Date.parse("2026-10-21T02:00:00Z");
    expect(bahiaDateInput(ms)).toBe("2026-10-20");
    expect(bahiaTimeInput(ms)).toBe("23:00");
  });
});
