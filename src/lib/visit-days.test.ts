import { expect, it } from "vitest";
import { mergeVisitDays } from "./visit-days";

it("horário e comanda do mesmo dia numa linha só; futuros primeiro (o mais perto em cima), depois os passados (o mais recente)", () => {
  const days = mergeVisitDays(
    [
      { id: "a1", startsAt: "2026-09-10T13:00:00Z", status: "compareceu", serviceLabel: "Escova", professionalName: "MAIARA", notes: "Gosta de água morna" },
      { id: "a2", startsAt: "2026-10-20T17:00:00Z", status: "agendado", serviceLabel: "Corte", professionalName: null, notes: null },
      { id: "a3", startsAt: "2026-11-02T13:00:00Z", status: "confirmado", serviceLabel: "Escova", professionalName: null, notes: null },
    ],
    [
      { id: "i1", soldOn: "2026-09-10", item: "Escova", professionalName: "MAIARA", totalCents: 12_000, fromPackage: false },
      { id: "i2", soldOn: "2026-09-10", item: "Hidratação", professionalName: "MAIARA", totalCents: 8_000, fromPackage: true },
      { id: "i3", soldOn: "2026-08-01", item: "Corte", professionalName: null, totalCents: null, fromPackage: false },
    ],
    "2026-10-15",
  );
  expect(days.map((d) => [d.day, d.future])).toEqual([["2026-10-20", true], ["2026-11-02", true], ["2026-09-10", false], ["2026-08-01", false]]);
  expect(days[2]).toMatchObject({ totalCents: 20_000 });
  expect(days[2].appointments[0].notes).toBe("Gosta de água morna");
  expect(days[3].totalCents).toBeNull(); // sem valor (quem não vê valores recebe null)
});
