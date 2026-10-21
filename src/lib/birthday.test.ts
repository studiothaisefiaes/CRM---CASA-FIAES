import { expect, it } from "vitest";
import { birthdayLabel, parseBirthday } from "./birthday";

it("lê dia/mês e dia/mês/ano; recusa data que não existe", () => {
  expect(parseBirthday("5/3")).toEqual({ ok: true, day: 5, month: 3, year: null });
  expect(parseBirthday("29/02/1992")).toEqual({ ok: true, day: 29, month: 2, year: 1992 });
  expect(parseBirthday("31/02")).toEqual({ ok: false, error: "Data de aniversário inválida." });
  expect(parseBirthday("29/02/1991")).toEqual({ ok: false, error: "Data de aniversário inválida." });
  expect(parseBirthday("março")).toEqual({ ok: false, error: "Use dia/mês, ex.: 14/11." });
});
it("rótulo: 05/03 ou 05/03/1992; sem dia, nada", () => {
  expect(birthdayLabel(5, 3)).toBe("05/03");
  expect(birthdayLabel(5, 3, 1992)).toBe("05/03/1992");
  expect(birthdayLabel(null, null)).toBeNull();
});
