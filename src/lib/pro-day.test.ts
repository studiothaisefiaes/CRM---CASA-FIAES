import { describe, expect, it } from "vitest";
import { atMinute, birthdayWithin, dayTimeline, dayTitle, greeting, hhmm, hourLabel, lastVisitLabel, minuteIn, pickNext, proActionsFor, rangesLabel, timeOf, titleCase, todayHeader, untilLabel } from "./pro-day";

/** Instante de Salvador escrito à mão: o teste não depende do fuso do processo (rode também com TZ=UTC e TZ=Asia/Tokyo). */
const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);

describe("textos do app da profissional (relógio de Salvador em qualquer aparelho)", () => {
  it("apelido, saudação e dia (16/10/2026 é sexta)", () => {
    expect(titleCase("MAIARA")).toBe("Maiara");
    expect(titleCase("ANA PAULA")).toBe("Ana Paula");
    expect(greeting(bahia("2026-10-16", "09:10").getTime())).toBe("Bom dia");
    expect(greeting(bahia("2026-10-16", "12:00").getTime())).toBe("Boa tarde");
    expect(greeting(bahia("2026-10-16", "18:00").getTime())).toBe("Boa noite");
    expect(dayTitle("2026-10-16")).toBe("sexta, 16 de out");
    expect(dayTitle("2026-10-17")).toBe("sábado, 17 de out");
  });

  it("faixas do dia: horário com intervalo, minutos e Folga", () => {
    expect(hourLabel(540)).toBe("9h");
    expect(hourLabel(810)).toBe("13h30");
    expect(rangesLabel([[540, 1080]])).toBe("9h–18h");
    expect(rangesLabel([[540, 720], [810, 1080]])).toBe("9h–12h e 13h30–18h");
    expect(rangesLabel([])).toBe("Folga");
  });

  it("cabeçalho do Hoje", () => {
    expect(todayHeader({ name: "MAIARA", nowMs: bahia("2026-10-16", "09:10").getTime(), day: "2026-10-16", clients: 6, ranges: [[540, 1080]] }))
      .toEqual({ greeting: "Bom dia, Maiara", line: "sexta, 16 de out · 6 clientes · 9h–18h" });
    expect(todayHeader({ name: "ana", nowMs: bahia("2026-10-16", "20:00").getTime(), day: "2026-10-16", clients: 1, ranges: [] }).line)
      .toBe("sexta, 16 de out · 1 cliente · Folga");
  });

  it("hora e minuto do dia não dependem do fuso do aparelho", () => {
    expect(timeOf(bahia("2026-10-16", "23:30").getTime())).toBe("23:30");
    expect(minuteIn(bahia("2026-10-16", "10:20").getTime())).toBe(620);
    expect(atMinute("2026-10-16", 620).toISOString()).toBe("2026-10-16T13:20:00.000Z");
    expect(hhmm(620)).toBe("10:20");
  });
});

describe("a linha do dia e os botões", () => {
  it("quanto falta: em 25 min, em 1h10, há 5 min, agora", () => {
    const now = bahia("2026-10-16", "09:35").getTime();
    expect(untilLabel(bahia("2026-10-16", "10:00").getTime(), now)).toBe("em 25 min");
    expect(untilLabel(bahia("2026-10-16", "10:45").getTime(), now)).toBe("em 1h10");
    expect(untilLabel(bahia("2026-10-16", "09:30").getTime(), now)).toBe("há 5 min");
    expect(untilLabel(now, now)).toBe("agora");
  });

  it("livres dentro do horário de trabalho; sem duração ocupa um passo; faltou e pedido de folga não ocupam", () => {
    expect(dayTimeline({
      ranges: [[540, 1080]],
      appts: [{ id: "a", start: 600, durationMin: 80, status: "agendado" }, { id: "b", start: 900, durationMin: null, status: "confirmado" }, { id: "c", start: 960, durationMin: 60, status: "faltou" }],
      blocks: [{ id: "x", title: "Almoço", start: 720, end: 780, pending: false }, { id: "y", title: "Folga pedida", start: 1020, end: 1080, pending: true }],
    })).toEqual([
      { kind: "livre", start: 540, end: 600 },
      { kind: "horario", id: "a", start: 600 },
      { kind: "livre", start: 680, end: 720 },
      { kind: "bloqueio", id: "x", title: "Almoço", start: 720, end: 780, pending: false },
      { kind: "livre", start: 780, end: 900 },
      { kind: "horario", id: "b", start: 900 },
      { kind: "livre", start: 930, end: 1080 },
      { kind: "horario", id: "c", start: 960 },
      { kind: "bloqueio", id: "y", title: "Folga pedida", start: 1020, end: 1080, pending: true },
    ]);
    expect(dayTimeline({ ranges: [], appts: [], blocks: [] })).toEqual([]);
    expect(dayTimeline({ ranges: [[540, 600]], appts: [{ id: "a", start: 540, durationMin: 50, status: "agendado" }], blocks: [] })).toEqual([{ kind: "horario", id: "a", start: 540 }]);
  });

  it("os botões seguem a tabela de transições; Faltou só 15 min depois do início", () => {
    const s = bahia("2026-10-16", "10:00").getTime();
    expect(proActionsFor("agendado", s, bahia("2026-10-16", "09:00").getTime())).toEqual(["chegou", "iniciar"]);
    expect(proActionsFor("confirmado", s, bahia("2026-10-16", "10:05").getTime())).toEqual(["chegou", "iniciar", "finalizar"]);
    expect(proActionsFor("agendado", s, bahia("2026-10-16", "10:15").getTime())).toEqual(["chegou", "iniciar", "finalizar", "faltou"]);
    expect(proActionsFor("agendado", s, bahia("2026-10-15", "18:00").getTime())).toEqual([]);
    expect(proActionsFor("chegou", s, bahia("2026-10-16", "09:50").getTime())).toEqual(["iniciar", "finalizar"]);
    expect(proActionsFor("em_atendimento", s, bahia("2026-10-16", "10:30").getTime())).toEqual(["finalizar"]);
    expect(proActionsFor("compareceu", s, bahia("2026-10-16", "11:30").getTime())).toEqual([]);
  });

  it("próxima cliente: a que está na cadeira; senão a próxima, até 15 min depois do início", () => {
    const items = [{ id: "a", status: "compareceu", start: 540 }, { id: "b", status: "agendado", start: 600 }, { id: "c", status: "confirmado", start: 660 }];
    expect(pickNext(items, 610)?.id).toBe("b");
    expect(pickNext(items, 620)?.id).toBe("c");
    expect(pickNext([...items, { id: "d", status: "chegou", start: 720 }], 610)?.id).toBe("d");
    expect(pickNext(items, 900)).toBeNull();
  });

  it("aniversário nos próximos 7 dias (virada de ano e 29/02) e última visita sem valor", () => {
    expect(birthdayWithin(20, 10, "2026-10-16")).toBe(true);
    expect(birthdayWithin(22, 10, "2026-10-16")).toBe(true);
    expect(birthdayWithin(23, 10, "2026-10-16")).toBe(false);
    expect(birthdayWithin(15, 10, "2026-10-16")).toBe(false);
    expect(birthdayWithin(2, 1, "2026-12-28")).toBe(true);
    expect(birthdayWithin(29, 2, "2027-02-25")).toBe(true);
    expect(birthdayWithin(null, 2, "2027-02-25")).toBe(false);
    expect(lastVisitLabel({ startsAt: bahia("2026-08-12", "15:00"), service: "Luzes", professional: "BIA" })).toBe("12/08 · Luzes com a Bia");
  });
});
