import { describe, expect, it } from "vitest";
import { parseWithDates, stringifyWithDates } from "./json-dates";

describe("JSON com datas", () => {
  it("Date volta como Date (no topo, em objeto, em lista e aninhado); o resto fica igual", () => {
    const at = new Date("2026-10-16T12:34:56.789Z");
    const value = { at, list: [at, { deep: at }], text: "2026-10-16T12:34:56.789Z", n: 3, nil: null, ok: true };
    const back = parseWithDates<typeof value>(stringifyWithDates(value));
    expect(back.at).toBeInstanceOf(Date);
    expect(back.at.getTime()).toBe(at.getTime());
    expect((back.list[0] as Date).getTime()).toBe(at.getTime());
    expect((back.list[1] as { deep: Date }).deep).toBeInstanceOf(Date);
    // Texto com cara de data continua texto: só o que era Date vira Date.
    expect(back.text).toBe("2026-10-16T12:34:56.789Z");
    expect(back).toMatchObject({ n: 3, nil: null, ok: true });
    expect(parseWithDates<Date>(stringifyWithDates(at))).toEqual(at);
  });

  it("Date inválida vira null (como no JSON comum) e undefined some", () => {
    const back = parseWithDates<{ bad: Date | null; u?: number }>(stringifyWithDates({ bad: new Date("x"), u: undefined }));
    expect(back.bad).toBeNull();
    expect("u" in back).toBe(false);
  });

  it("objeto que só parece o marcador ($d com outra chave ou não-texto) não vira Date", () => {
    const back = parseWithDates<{ a: unknown; b: unknown }>(stringifyWithDates({ a: { $d: "2026-01-01T00:00:00.000Z", x: 1 }, b: { $d: 5 } }));
    expect(back.a).toEqual({ $d: "2026-01-01T00:00:00.000Z", x: 1 });
    expect(back.b).toEqual({ $d: 5 });
  });
});
