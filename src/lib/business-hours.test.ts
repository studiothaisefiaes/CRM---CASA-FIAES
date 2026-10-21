import { describe, it, expect } from "vitest";
import { windowOf, businessDayLabel, businessInstantBefore, businessMinutesBetween, businessSecondsBetween, isOpen, lastClosingBefore, daysCountingOpenDays, DEFAULT_HOURS, type BusinessHours } from "./business-hours";

const at = (iso: string) => new Date(iso).getTime(); // horários em UTC; Salvador = UTC-3

describe("horário de atendimento", () => {
  it("conta só o expediente", () => {
    // sex 09/10 19:55 local (22:55Z) → sáb 10/10 08:03 local (11:03Z): 5 min na sexta + 3 min no sábado
    expect(businessMinutesBetween(at("2026-10-09T22:55:00Z"), at("2026-10-10T11:03:00Z"))).toBe(8);
  });
  it("domingo não conta", () => {
    // sáb 16:58 local → seg 08:01 local
    expect(businessMinutesBetween(at("2026-10-10T19:58:00Z"), at("2026-10-12T11:01:00Z"))).toBe(3);
  });
  it("dentro do expediente é o tempo normal", () => {
    expect(businessMinutesBetween(at("2026-10-09T13:00:00Z"), at("2026-10-09T13:02:30Z"))).toBe(2);
  });
  it("aberto ou fechado", () => {
    expect(isOpen(at("2026-10-09T13:00:00Z"))).toBe(true);  // sex 10h
    expect(isOpen(at("2026-10-11T13:00:00Z"))).toBe(false); // dom
    expect(isOpen(at("2026-10-10T02:00:00Z"))).toBe(false); // sex 23h
  });
});

describe("businessDayLabel", () => {
  it("diz o expediente do dia para avisar o agendamento fora do horário", () => {
    expect(businessDayLabel(at("2026-10-10T21:00:00Z"))).toBe("sábado, das 8:00 às 17:00"); // sáb 18:00 local
    expect(businessDayLabel(at("2026-10-11T15:00:00Z"))).toBe("domingo, a Casa não abre");
    expect(businessDayLabel(at("2026-10-07T17:00:00Z"))).toBe("quarta, das 8:00 às 20:00");
  });
});

describe("businessInstantBefore (demonstração: posicionar esperas em relação ao agora)", () => {
  const iso = (ms: number) => new Date(ms).toISOString();
  it("no expediente, é só voltar o relógio", () => {
    // segunda 12/10/2026 10:00 em Salvador = 13:00Z
    expect(iso(businessInstantBefore(at("2026-10-12T13:00:00Z"), 600))).toBe("2026-10-12T12:50:00.000Z");
  });
  it("de madrugada, cai no fim do último expediente (sábado 17h)", () => {
    // segunda 02:00 em Salvador = 05:00Z; sábado 10/10 às 17:00 = 20:00Z; 10 min antes = 19:50Z
    expect(iso(businessInstantBefore(at("2026-10-12T05:00:00Z"), 600))).toBe("2026-10-10T19:50:00.000Z");
  });
  it("atravessa o fechamento: 5 min de segunda + 5 min de sábado", () => {
    expect(iso(businessInstantBefore(at("2026-10-12T11:05:00Z"), 600))).toBe("2026-10-10T19:55:00.000Z");
  });
  it("é o inverso de businessSecondsBetween", () => {
    for (const now of ["2026-10-12T05:00:00Z", "2026-10-12T11:01:30Z", "2026-10-14T22:59:00Z", "2026-10-11T15:00:00Z"]) {
      for (const s of [1, 75, 600, 1080]) {
        const from = businessInstantBefore(at(now), s);
        expect(businessSecondsBetween(from, at(now))).toBe(s);
        expect(isOpen(from)).toBe(true);
      }
    }
  });
});

describe("lastClosingBefore", () => {
  /** Horário da Casa (Lote 0): terça a sábado, 9h às 18h. */
  const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
  it("terça 9:02 com domingo e segunda fechados: o último fechamento foi sábado 18h", () => {
    expect(iso(lastClosingBefore(at("2026-10-20T12:02:00Z"), CASA))).toBe("2026-10-17T21:00:00.000Z");
  });
  it("quarta de manhã: a noite de terça; com a Casa aberta, o expediente de hoje ainda não conta", () => {
    expect(iso(lastClosingBefore(at("2026-10-21T12:02:00Z"), CASA))).toBe("2026-10-20T21:00:00.000Z");
    expect(iso(lastClosingBefore(at("2026-10-20T20:59:00Z"), CASA))).toBe("2026-10-17T21:00:00.000Z");
  });
  it("padrão: segunda 8:05 → sábado 17h; sem expediente nenhum, null", () => {
    expect(iso(lastClosingBefore(at("2026-10-12T11:05:00Z")))).toBe("2026-10-10T20:00:00.000Z");
    expect(lastClosingBefore(at("2026-10-12T11:05:00Z"), { 0: null, 1: null, 2: null, 3: null, 4: null, 5: null, 6: null })).toBeNull();
  });
});

describe("daysCountingOpenDays", () => {
  const CASA: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
  it("domingo e segunda fechados não contam como dia parado: sábado 17:55 → terça 9:02 é 0 dia", () => {
    expect(daysCountingOpenDays(at("2026-10-17T20:55:00Z"), at("2026-10-20T12:02:00Z"), CASA)).toBe(0);
  });
  it("sábado 17:00 → quarta 17:01 são 2 dias (sábado à noite, terça e quarta)", () => {
    expect(daysCountingOpenDays(at("2026-10-17T20:00:00Z"), at("2026-10-21T20:01:00Z"), CASA)).toBe(2);
  });
  it("semana aberta: é o relógio comum", () => {
    expect(daysCountingOpenDays(at("2026-10-13T13:00:00Z"), at("2026-10-16T13:00:00Z"), CASA)).toBe(3);
    expect(daysCountingOpenDays(at("2026-10-16T13:00:00Z"), at("2026-10-13T13:00:00Z"), CASA)).toBe(0);
  });
});

describe("dias especiais (`especiais`)", () => {
  const XMAS = { ...DEFAULT_HOURS, especiais: { "2026-12-24": ["08:00", "13:00"] as [string, string], "2026-12-25": null } };
  const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());
  it("windowOf: o dia especial vence o dia da semana (null = fechado) e sem ele vale a semana", () => {
    expect(windowOf(Date.UTC(2026, 11, 24), XMAS)).toEqual(["08:00", "13:00"]);
    expect(windowOf(Date.UTC(2026, 11, 25), XMAS)).toBeNull(); // sexta que a semana abre
    expect(windowOf(Date.UTC(2026, 11, 23), XMAS)).toEqual(["08:00", "20:00"]);
    expect(windowOf(Date.UTC(2026, 11, 27), { ...XMAS, especiais: { "2026-12-27": ["10:00", "14:00"] } })).toEqual(["10:00", "14:00"]); // domingo aberto por exceção
  });
  it("dia especial com horário reduzido fecha mais cedo", () => {
    expect(isOpen(at("2026-12-24T15:59:00Z"), XMAS)).toBe(true); // 12:59
    expect(isOpen(at("2026-12-24T16:00:00Z"), XMAS)).toBe(false); // 13:00
  });
  it("dia especial fechado num dia de semana: não abre e não conta prazo", () => {
    expect(isOpen(at("2026-12-25T13:00:00Z"), XMAS)).toBe(false);
    expect(businessMinutesBetween(at("2026-12-24T15:00:00Z"), at("2026-12-26T12:00:00Z"), XMAS)).toBe(60 + 60);
  });
  it("businessInstantBefore volta pulando o feriado", () => {
    // sáb 26/12 08:20 local: 20 min até a abertura; os outros 10 min voltam para 24/12 12:50 (o 25 não existe)
    expect(iso(businessInstantBefore(at("2026-12-26T11:20:00Z"), 1800, XMAS))).toBe("2026-12-24T15:50:00.000Z");
  });
  it("lastClosingBefore e daysCountingOpenDays respeitam o dia especial", () => {
    // sáb 26/12 09:00 local: o último fechamento foi 24/12 13:00 (16:00Z); sem o feriado seria 25/12 20:00
    expect(iso(lastClosingBefore(at("2026-12-26T12:00:00Z"), XMAS))).toBe("2026-12-24T16:00:00.000Z");
    expect(iso(lastClosingBefore(at("2026-12-26T12:00:00Z"), DEFAULT_HOURS))).toBe("2026-12-25T23:00:00.000Z");
    // 23/12 12:00 -> 26/12 12:00: 3 dias, menos o feriado (25) = 2
    expect(daysCountingOpenDays(at("2026-12-23T15:00:00Z"), at("2026-12-26T15:00:00Z"), XMAS)).toBe(2);
    expect(daysCountingOpenDays(at("2026-12-23T15:00:00Z"), at("2026-12-26T15:00:00Z"), DEFAULT_HOURS)).toBe(3);
  });
  it("businessDayLabel diz o horário reduzido e o feriado", () => {
    expect(businessDayLabel(at("2026-12-24T15:00:00Z"), XMAS)).toBe("quinta, das 8:00 às 13:00");
    expect(businessDayLabel(at("2026-12-25T15:00:00Z"), XMAS)).toBe("sexta, a Casa não abre");
  });
  it("sem `especiais` nada muda (compatível com o horário salvo hoje)", () => {
    expect(isOpen(at("2026-12-25T13:00:00Z"), DEFAULT_HOURS)).toBe(true);
    expect(isOpen(at("2026-12-25T13:00:00Z"), { ...DEFAULT_HOURS, especiais: {} })).toBe(true);
    expect(businessMinutesBetween(at("2026-12-24T15:00:00Z"), at("2026-12-26T12:00:00Z"), DEFAULT_HOURS)).toBe(480 + 720 + 60);
  });
});

describe("próxima abertura e o prazo da resposta fora do horário (pesquisa 20/10)", () => {
  it("nextOpeningAfter e openingPhrase: hoje, amanhã, dia da semana e dia especial", async () => {
    const { nextOpeningAfter } = await import("./business-hours");
    const { openingPhrase, fillOpening } = await import("./auto-message-text");
    const h = { ...DEFAULT_HOURS, "1": null, "2": ["09:00", "19:00"] as [string, string] }; // segunda fechada, terça às 9h
    const sab18 = Date.parse("2026-10-17T21:00:00Z"); // sábado 18h
    expect(new Date(nextOpeningAfter(sab18, h)!).toISOString()).toBe("2026-10-20T12:00:00.000Z"); // terça 9h
    expect(openingPhrase(sab18, h)).toBe("na terça a partir das 9h");
    expect(openingPhrase(Date.parse("2026-10-14T02:00:00Z"), DEFAULT_HOURS)).toBe("amanhã a partir das 8h"); // ter 23h
    expect(openingPhrase(Date.parse("2026-10-14T09:00:00Z"), DEFAULT_HOURS)).toBe("hoje a partir das 8h"); // qua 6h
    expect(openingPhrase(Date.parse("2026-10-14T02:00:00Z"), { ...DEFAULT_HOURS, "3": ["08:30", "20:00"] })).toBe("amanhã a partir das 8h30");
    expect(openingPhrase(Date.parse("2026-10-14T02:00:00Z"), { ...DEFAULT_HOURS, especiais: { "2026-10-14": null } })).toBe("na quinta a partir das 8h");
    const closed = { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null } as typeof DEFAULT_HOURS;
    expect(openingPhrase(sab18, closed)).toBe("assim que a Casa abrir");
    expect(fillOpening("respondemos {abertura}.", sab18, h)).toBe("respondemos na terça a partir das 9h.");
  });
});
