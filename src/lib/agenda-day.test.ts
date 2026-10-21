import { describe, expect, it } from "vitest";
import { instantOf } from "./agenda";
import { canPlace, freeGaps, highlightOpenKey, NO_BAIXA_DAYS, noBaixaRange, isMovable, minuteAt, noBaixa, occupancy, placeOptions, viewStatus, type PlaceCtx, type PlaceItem } from "./agenda-day";

const DAY = "2026-10-16";
const at = (min: number) => instantOf(DAY, min).toISOString();
const NOW = instantOf(DAY, 10 * 60 + 40).getTime(); // 10:40

const item = (o: Partial<PlaceItem> & { key: string }): PlaceItem => ({
  source: "agendamento", professionalId: "liv", name: "Mirela Campos", scheduledAt: at(14 * 60), durationMin: 60, status: "agendado", dbStatus: "agendado", noTime: false, ...o,
});
const ctx = (items: PlaceItem[], over: Partial<PlaceCtx> = {}): PlaceCtx => ({
  nowMs: NOW, day: DAY, today: DAY, items, names: { liv: "Lívia Santos", hel: "Heloísa Prado", kat: "Kátia Reis" },
  hours: { liv: { ranges: [[540, 1140]], off: false }, hel: { ranges: [[540, 1140]], off: false }, kat: { ranges: [], off: true } },
  blocks: [{ professionalId: "hel", start: 720, end: 780, title: "Almoço" }],
  ...over,
});

describe("viewStatus", () => {
  const base = { source: "agendamento", status: "agendado", dbStatus: "agendado", scheduledAt: at(11 * 60), paid: false };
  it("antes da hora e até 15 min depois: marcado/confirmado; depois disso, sem baixa (vermelho)", () => {
    expect(viewStatus(base, NOW)).toBe("marcado");
    expect(viewStatus({ ...base, dbStatus: "confirmado", scheduledAt: at(10 * 60 + 30) }, NOW)).toBe("confirmado");
    expect(viewStatus({ ...base, scheduledAt: at(10 * 60 + 25) }, NOW)).toBe("sembaixa");
  });
  it("ciclo: chegou, atendendo; finalizado só falta pagar com o caixa no CRM", () => {
    expect(viewStatus({ ...base, dbStatus: "chegou" }, NOW)).toBe("chegou");
    expect(viewStatus({ ...base, dbStatus: "em_atendimento" }, NOW)).toBe("atendendo");
    expect(viewStatus({ ...base, dbStatus: "compareceu" }, NOW)).toBe("pago");
    expect(viewStatus({ ...base, dbStatus: "compareceu" }, NOW, { caixaOn: true })).toBe("finalizado");
    expect(viewStatus({ ...base, dbStatus: "compareceu", paid: true }, NOW, { caixaOn: true })).toBe("pago");
    expect(viewStatus({ ...base, dbStatus: "solicitado" }, NOW)).toBe("pedido");
  });
  it("lead (conversa em Agendado) usa o status calculado", () => {
    expect(viewStatus({ source: "lead", status: "conferir", dbStatus: null, scheduledAt: at(9 * 60), paid: false }, NOW)).toBe("sembaixa");
    expect(viewStatus({ source: "lead", status: "remarcou", dbStatus: null, scheduledAt: at(9 * 60), paid: false }, NOW)).toBe("encerrado");
  });
});

describe("highlightOpenKey (link \"Abrir o horário\", ?destaque=)", () => {
  it("abre o horário destacado quando ele está no dia; sem destaque ou de outro dia, nada abre", () => {
    const items = [{ key: "ag:a1", appointmentId: "a1" }, { key: "lead:d1", appointmentId: null }];
    expect(highlightOpenKey("a1", items)).toBe("ag:a1");
    expect(highlightOpenKey("zz", items)).toBeNull();
    expect(highlightOpenKey(null, items)).toBeNull();
  });
});

describe("noBaixaRange (Pendências › Sem baixa)", () => {
  it("a semana: os 7 dias até hoje, de meia-noite em Salvador (antes eram só ontem e hoje)", () => {
    expect(NO_BAIXA_DAYS).toBe(7);
    const r = noBaixaRange("2026-10-17");
    expect(r).toMatchObject({ day: "2026-10-11", view: "dia", days: 7 });
    expect(r.from.toISOString()).toBe("2026-10-11T03:00:00.000Z");
  });
});

describe("noBaixa", () => {
  it("só agendado/confirmado da agenda que passou da tolerância, do mais antigo", () => {
    const items = [
      { key: "a", source: "agendamento", dbStatus: "confirmado", scheduledAt: at(10 * 60), noTime: false },
      { key: "b", source: "agendamento", dbStatus: "chegou", scheduledAt: at(9 * 60), noTime: false },
      { key: "c", source: "agendamento", dbStatus: "agendado", scheduledAt: instantOf("2026-10-15", 16 * 60).toISOString(), noTime: false },
      { key: "d", source: "agendamento", dbStatus: "agendado", scheduledAt: at(10 * 60 + 30), noTime: false },
      { key: "e", source: "lead", dbStatus: null, scheduledAt: at(9 * 60), noTime: false },
    ];
    expect(noBaixa(items, NOW).map((i) => i.key)).toEqual(["c", "a"]);
  });
});

describe("canPlace (arrastar e Mover…)", () => {
  const mirela = item({ key: "m" });
  const ana = item({ key: "a", name: "Ana Clara Souza", professionalId: "hel", scheduledAt: at(15 * 60), durationMin: 90 });
  const c = ctx([mirela, ana]);
  it("livre na outra profissional: ok", () => expect(canPlace(mirela, "hel", 10 * 60 + 45, c)).toEqual({ ok: true }));
  it("recusa em cima de outro horário, dizendo quem", () => expect(canPlace(mirela, "hel", 15 * 60 + 30, c)).toEqual({ ok: false, why: "Heloísa já atende Ana às 15:00." }));
  it("recusa no almoço/bloqueio", () => expect(canPlace(mirela, "hel", 11 * 60 + 30, c)).toEqual({ ok: false, why: "Heloísa tem almoço das 12:00 às 13:00." }));
  it("recusa na folga e fora do horário de trabalho", () => {
    expect(canPlace(mirela, "kat", 11 * 60, c)).toEqual({ ok: false, why: "Kátia está de folga neste dia." });
    expect(canPlace(mirela, "liv", 18 * 60 + 30, c)).toEqual({ ok: false, why: "fica fora do horário da Lívia." });
  });
  it("recusa no passado (hoje antes de agora, ou dia que passou)", () => {
    expect(canPlace(mirela, "liv", 10 * 60, c)).toEqual({ ok: false, why: "esse horário já passou." });
    expect(canPlace(mirela, "liv", 11 * 60, ctx([mirela], { today: "2026-10-17" }))).toEqual({ ok: false, why: "esse dia já passou." });
  });
  it("não move o que já começou; o próprio horário não conta como choque", () => {
    expect(canPlace({ ...mirela, dbStatus: "chegou" }, "liv", 15 * 60, c).ok).toBe(false);
    expect(canPlace(mirela, "liv", 14 * 60 + 30, c)).toEqual({ ok: true });
    expect(isMovable({ source: "lead", dbStatus: null, noTime: false })).toBe(false);
  });
  it("recusa quem não faz o serviço (serviço sem ninguém cadastrado: qualquer uma)", () => {
    const corte = { ...mirela, serviceId: "s1", service: "Corte" };
    expect(canPlace(corte, "hel", 10 * 60 + 45, { ...c, doers: { s1: ["liv"] } })).toEqual({ ok: false, why: "Heloísa não faz corte." });
    expect(canPlace(corte, "hel", 10 * 60 + 45, { ...c, doers: { s1: [] } })).toEqual({ ok: true });
  });
  it("cancelado e faltou não ocupam", () => {
    const c2 = ctx([mirela, { ...ana, dbStatus: "cancelado", status: "cancelado" }]);
    expect(canPlace(mirela, "hel", 15 * 60, c2)).toEqual({ ok: true });
  });
});

describe("placeOptions, minuteAt, freeGaps, occupancy", () => {
  const mirela = item({ key: "m" });
  const c = ctx([mirela, item({ key: "x", professionalId: "hel", scheduledAt: at(14 * 60), durationMin: 120 })]);
  it("opções do Mover…: só onde cabe, sem a hora atual dela", () => {
    const opts = placeOptions(mirela, "hel", c, { start: 540, end: 1140 });
    expect(opts[0]).toBe(10 * 60 + 45); // começo do buraco depois de agora
    expect(opts).not.toContain(12 * 60); // almoço
    expect(opts).not.toContain(14 * 60); // ocupado
    expect(opts).toContain(16 * 60);
    expect(placeOptions(mirela, "liv", c, { start: 540, end: 1140 })).not.toContain(14 * 60);
  });
  it("minuteAt encaixa no passo e fica dentro do visível", () => {
    expect(minuteAt(0, 1.5, { start: 540, end: 1140 }, 15)).toBe(540);
    expect(minuteAt(1.5 * 100, 1.5, { start: 540, end: 1140 }, 30)).toBe(630);
    expect(minuteAt(99999, 1.5, { start: 540, end: 1140 }, 30)).toBe(1110);
  });
  it("buracos de 30+ min do agora em diante; ocupação em % sem o almoço", () => {
    expect(freeGaps("hel", c)).toEqual([[645, 720], [780, 840], [960, 1140]]);
    expect(freeGaps("kat", c)).toEqual([]);
    expect(occupancy("hel", c)).toBe(Math.round((120 / (600 - 60)) * 100));
    expect(occupancy("kat", c)).toBe(0);
  });
});

describe("noBaixa e a CLIENTE PADRÃO (17/10)", () => {
  it("horário da cliente genérica do Avec não pede baixa", () => {
    const items = [
      { key: "p", source: "agendamento", dbStatus: "agendado", scheduledAt: at(9 * 60), noTime: false, genericClient: true },
      { key: "r", source: "agendamento", dbStatus: "agendado", scheduledAt: at(9 * 60), noTime: false, genericClient: false },
    ];
    expect(noBaixa(items, NOW).map((i) => i.key)).toEqual(["r"]);
  });
});

describe("auxiliar no horário (0089)", () => {
  // Mirela com a Lívia às 14h, Heloísa de auxiliar
  const mirela = item({ key: "ag:m", assistants: [{ id: "hel" }] });
  const outra = item({ key: "ag:o", professionalId: "kat", name: "Ana Souza", scheduledAt: at(16 * 60) });
  const c = ctx([mirela, outra], { blocks: [] });
  it("a auxiliar fica ocupada na coluna dela: não solta outro horário por cima, sem buraco livre e conta na ocupação", () => {
    expect(canPlace(outra, "hel", 14 * 60 + 30, { ...c, hours: { ...c.hours, kat: { ranges: [[540, 1140]], off: false } } })).toEqual({ ok: false, why: "Heloísa já atende Mirela às 14:00." });
    expect(freeGaps("hel", c)).toEqual([[645, 840], [900, 1140]]); // do agora (10:40 → 10:45) em diante
    expect(occupancy("hel", c)).toBe(10);
  });
  it("passar o horário para a própria auxiliar é recusado", () => {
    expect(canPlace(mirela, "hel", 15 * 60, c)).toEqual({ ok: false, why: "Heloísa é auxiliar deste horário." });
  });
});
