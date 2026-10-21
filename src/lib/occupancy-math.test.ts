import { expect, it } from "vitest";
import { availableMinutes, clippedMinutes, subtractRanges } from "./occupancy-math";

it("disponível: 9–18 com almoço 12–13 = 480 min; bloqueio do dia inteiro = 0", () => {
  expect(availableMinutes([[540, 1080]], [[720, 780]])).toBe(480);
  expect(availableMinutes([[540, 1080]], [[0, 1440]])).toBe(0);
});
it("bloqueios sobrepostos descontam uma vez só; faixas sem bloqueio ficam inteiras", () => {
  expect(availableMinutes([[540, 1080]], [[600, 700], [650, 720]])).toBe(540 - 120);
  expect(availableMinutes([[540, 720], [780, 1080]], [])).toBe(180 + 300);
});
it("agendado que passa do fim do expediente conta só até o fim; dois horários sobrepostos não contam 2x", () => {
  expect(clippedMinutes([[1020, 1110]], [[540, 1080]])).toBe(60);
  expect(clippedMinutes([[600, 660], [630, 690]], [[540, 1080]])).toBe(90);
});
it("subtractRanges tira os bloqueios das faixas", () => {
  expect(subtractRanges([[540, 1080]], [[720, 780]])).toEqual([[540, 720], [780, 1080]]);
});
