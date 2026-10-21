import { describe, it, expect } from "vitest";
import { summarizeHours } from "./hours-summary";
import { DEFAULT_HOURS } from "./business-hours";

describe("summarizeHours", () => {
  it("padrão: seg–sex 8–20, sáb 8–17", () => expect(summarizeHours(DEFAULT_HOURS)).toBe("seg–sex 8–20, sáb 8–17"));
  it("dia solto, minutos e 24 horas", () => {
    expect(summarizeHours({ ...DEFAULT_HOURS, "3": ["09:30", "18:00"] })).toBe("seg–ter 8–20, qua 9h30–18, qui–sex 8–20, sáb 8–17");
    expect(summarizeHours({ "0": ["00:00", "24:00"], "1": ["00:00", "24:00"], "2": null, "3": null, "4": null, "5": null, "6": null })).toBe("seg 24 horas, dom 24 horas");
  });
  it("tudo fechado", () => expect(summarizeHours({ "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null })).toBe("sempre fechado"));
});
