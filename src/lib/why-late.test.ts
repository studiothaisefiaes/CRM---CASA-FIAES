import { describe, expect, it } from "vitest";
import { opensText, whyLate } from "./why-late";
import { DEFAULT_HOURS, type BusinessHours } from "./business-hours";

/** Instante a partir de uma hora local de Salvador (UTC-3). */
const bahia = (iso: string) => new Date(`${iso}-03:00`);

describe("whyLate", () => {
  it("no expediente: diz quando a cliente escreveu, quanto da espera é de expediente e o prazo", () => {
    const text = whyLate({ awaitingSince: bahia("2026-10-07T14:02:00").toISOString(), slaMinutes: 2 }, DEFAULT_HOURS, bahia("2026-10-07T14:10:30"));
    expect(text).toBe("Cliente escreveu às 14:02 e ninguém respondeu (8 min no expediente; prazo 2 min)");
  });

  it("cruzando o fechamento: a Casa está fechada, diz desde quando e até quando", () => {
    // Sexta 19:40, a Casa fecha às 20:00; sábado fecha às 17:00 e domingo não abre: volta segunda 8:00.
    const text = whyLate({ awaitingSince: bahia("2026-10-09T19:40:00").toISOString(), slaMinutes: 2 }, DEFAULT_HOURS, bahia("2026-10-10T18:00:00"));
    expect(text).toBe("Sem resposta da Casa desde sexta 19:40 — Casa fechada até seg 8:00");
  });

  it("reaberta: a espera de outro dia conta só o expediente e o dia aparece", () => {
    // Escreveu quinta às 19:40 (20 min de expediente até fechar); hoje a Casa abriu às 8:00 e já são 8:30.
    const text = whyLate({ awaitingSince: bahia("2026-10-08T19:40:00").toISOString(), slaMinutes: 5 }, DEFAULT_HOURS, bahia("2026-10-09T08:30:00"));
    expect(text).toBe("Cliente escreveu quinta às 19:40 e ninguém respondeu (50 min no expediente; prazo 5 min)");
  });

  it("fechada logo à noite: reabre amanhã", () => {
    const text = whyLate({ awaitingSince: bahia("2026-10-07T19:50:00").toISOString(), slaMinutes: 2 }, DEFAULT_HOURS, bahia("2026-10-07T21:00:00"));
    expect(text).toBe("Sem resposta da Casa desde hoje 19:50 — Casa fechada até amanhã 8:00");
  });

  it("aguardando a cliente: diz quem respondeu, quando (com o dia) e por onde", () => {
    const at = bahia("2026-10-06T13:15:00").toISOString(); // ontem
    expect(whyLate({ awaitingSince: null, slaMinutes: 2, lastDirection: "out", lastAt: at, lastBy: "Cati Souza", lastFromPhone: true }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00")))
      .toBe("Cati respondeu ontem 13:15 pelo celular; agora é a vez da cliente.");
    expect(whyLate({ awaitingSince: null, slaMinutes: 2, lastDirection: "out", lastAt: bahia("2026-10-07T14:02:00").toISOString(), lastFromPhone: true }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00")))
      .toBe("A Casa respondeu hoje 14:02 pelo celular; agora é a vez da cliente.");
    expect(whyLate({ awaitingSince: null, slaMinutes: 2, lastDirection: "out", lastAt: bahia("2026-10-07T14:02:00").toISOString(), lastBy: "Sara", lastFromPhone: false }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00")))
      .toBe("Sara respondeu hoje 14:02; agora é a vez da cliente.");
  });

  it("sem espera e sem dados da última mensagem: a vez é da cliente, sem o nome antigo da seção", () => {
    expect(whyLate({ awaitingSince: null, slaMinutes: null }, DEFAULT_HOURS, bahia("2026-10-07T16:00:00"))).toBe("Agora é a vez da cliente.");
  });

  it("sem prazo na etapa e menos de 1 minuto: não inventa número", () => {
    const text = whyLate({ awaitingSince: bahia("2026-10-07T14:02:00").toISOString(), slaMinutes: null }, DEFAULT_HOURS, bahia("2026-10-07T14:02:20"));
    expect(text).toBe("Cliente escreveu às 14:02 e ninguém respondeu (menos de 1 min no expediente)");
  });

  it("usa o horário configurado e, sem horário nenhum, não promete reabertura", () => {
    const fechado: BusinessHours = { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null };
    const text = whyLate({ awaitingSince: bahia("2026-10-07T14:02:00").toISOString(), slaMinutes: 2 }, fechado, bahia("2026-10-07T15:00:00"));
    expect(text).toBe("Sem resposta da Casa desde hoje 14:02 — Casa fechada");
  });
});

describe("opensText (linha da Fila com a Casa fechada)", () => {
  it("diz quando a Casa abre, curto", () => {
    expect(opensText(bahia("2026-10-07T06:30:00").getTime(), DEFAULT_HOURS)).toBe("Casa abre às 8h"); // quarta cedo
    expect(opensText(bahia("2026-10-07T21:00:00").getTime(), DEFAULT_HOURS)).toBe("Casa abre amanhã às 8h");
    expect(opensText(bahia("2026-10-10T18:00:00").getTime(), DEFAULT_HOURS)).toBe("Casa abre seg às 8h"); // sábado à noite
    const meia: BusinessHours = { ...DEFAULT_HOURS, "3": ["09:30", "18:00"] };
    expect(opensText(bahia("2026-10-07T06:30:00").getTime(), meia)).toBe("Casa abre às 9h30");
    const nunca: BusinessHours = { "0": null, "1": null, "2": null, "3": null, "4": null, "5": null, "6": null };
    expect(opensText(bahia("2026-10-07T06:30:00").getTime(), nunca)).toBe("Casa fechada");
  });
});
