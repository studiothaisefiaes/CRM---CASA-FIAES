import { expect, it } from "vitest";
import { pickAnyPro } from "./online-booking";

it("'Qualquer uma': quem tem menos horários no dia; empate, a de menor ordem na agenda; depois o nome", () => {
  expect(pickAnyPro([{ id: "a", name: "Bia", agendaPosition: 1, dayCount: 3 }, { id: "b", name: "Ana", agendaPosition: 2, dayCount: 1 }])).toBe("b");
  expect(pickAnyPro([{ id: "a", name: "Bia", agendaPosition: 2, dayCount: 1 }, { id: "b", name: "Ana", agendaPosition: 1, dayCount: 1 }])).toBe("b");
  expect(pickAnyPro([{ id: "a", name: "Bia", agendaPosition: null, dayCount: 1 }, { id: "b", name: "Ana", agendaPosition: null, dayCount: 1 }])).toBe("b");
  expect(pickAnyPro([{ id: "a", name: "Bia", agendaPosition: 5, dayCount: 1 }, { id: "b", name: "Ana", agendaPosition: null, dayCount: 1 }])).toBe("a");
  expect(pickAnyPro([])).toBeNull();
});
