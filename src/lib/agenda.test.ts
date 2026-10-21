import { describe, expect, it } from "vitest";
import { agendaRange, agendaStatus, appointmentAgendaStatus, durationLabel, entryDuration, timeRange, hmToMinutes, instantOf, layoutLanes, minuteOfDay, shiftDay, STATUS_LABEL, validityLabel, weekDays } from "./agenda";

const NOW = new Date(Date.UTC(2026, 9, 14, 15, 0)); // quarta, 14/10, 12h em Salvador

describe("Agenda: período pedido na URL", () => {
  it("sem nada na URL: hoje em Salvador, visão Dia", () => {
    const r = agendaRange({}, NOW);
    expect(r).toMatchObject({ day: "2026-10-14", view: "dia", days: 1 });
    expect(r.from.toISOString()).toBe("2026-10-14T03:00:00.000Z"); // meia-noite de Salvador
  });
  it("de madrugada em UTC ainda é o dia anterior em Salvador", () => {
    expect(agendaRange({}, new Date(Date.UTC(2026, 9, 15, 2, 0))).day).toBe("2026-10-14");
  });
  it("Semana começa na segunda e cobre 7 dias", () => {
    const r = agendaRange({ d: "2026-10-14", v: "semana" }, NOW);
    expect(r).toMatchObject({ day: "2026-10-14", view: "semana", days: 7 });
    expect(r.from.toISOString()).toBe("2026-10-12T03:00:00.000Z");
    expect(weekDays(r)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  });
  it("domingo pertence à semana que começou na segunda anterior", () => {
    expect(agendaRange({ d: "2026-10-18", v: "semana" }, NOW).from.toISOString()).toBe("2026-10-12T03:00:00.000Z");
  });
  it("data inválida ou visão desconhecida caem em hoje / Dia", () => {
    expect(agendaRange({ d: "2026-13-45", v: "mes" }, NOW)).toMatchObject({ day: "2026-10-14", view: "dia" });
    expect(agendaRange({ d: "ontem" }, NOW).day).toBe("2026-10-14");
  });
  it("anda para trás e para frente por dia e por semana, atravessando o mês", () => {
    expect(shiftDay("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDay("2026-10-14", -7)).toBe("2026-10-07");
  });
});

describe("Agenda: situação de cada horário", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 14, h + 3)).toISOString();
  it("sem marcação: Agendado antes da hora, Conferir depois", () => {
    expect(agendaStatus({ scheduledAt: at(16), attendance: null, stageKind: "agendado" }, NOW)).toBe("agendado");
    expect(agendaStatus({ scheduledAt: at(10), attendance: null, stageKind: "agendado" }, NOW)).toBe("conferir");
    expect(agendaStatus({ scheduledAt: at(10), attendance: "confirmado", stageKind: "agendado" }, NOW)).toBe("conferir");
  });
  it("confirmado antes da hora; marcações valem como estão", () => {
    expect(agendaStatus({ scheduledAt: at(16), attendance: "confirmado", stageKind: "agendado" }, NOW)).toBe("confirmado");
    expect(agendaStatus({ scheduledAt: at(10), attendance: "compareceu", stageKind: "fechado" }, NOW)).toBe("compareceu");
    expect(agendaStatus({ scheduledAt: at(10), attendance: "faltou", stageKind: "agendado" }, NOW)).toBe("faltou");
  });
  it("lead perdido sem marcação não pede conferência", () => {
    expect(agendaStatus({ scheduledAt: at(10), attendance: null, stageKind: "perdido" }, NOW)).toBe("perdido");
  });
});

describe("Agenda: visão Profissionais", () => {
  it("é um dia só, como a visão Dia", () => {
    const r = agendaRange({ d: "2026-10-14", v: "profissionais" }, NOW);
    expect(agendaRange({ d: "2026-10-14", v: "profissionais" }, NOW)).toMatchObject({ day: "2026-10-14", view: "dia", days: 1 }); // apelido antigo
    expect(agendaRange({ d: "2026-10-14", v: "lista" }, NOW)).toMatchObject({ day: "2026-10-14", view: "lista", days: 1 });
    expect(r.from.toISOString()).toBe("2026-10-14T03:00:00.000Z");
  });
});

describe("Agenda: situação de um agendamento (Avec ou da Casa)", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 14, h + 3)).toISOString();
  it("agendado/confirmado antes da hora ficam como estão; depois da hora pedem conferência", () => {
    expect(appointmentAgendaStatus({ startsAt: at(16), status: "agendado" }, NOW)).toBe("agendado");
    expect(appointmentAgendaStatus({ startsAt: at(16), status: "confirmado" }, NOW)).toBe("confirmado");
    expect(appointmentAgendaStatus({ startsAt: at(10), status: "confirmado" }, NOW)).toBe("conferir");
  });
  it("compareceu, faltou e cancelado valem como estão", () => {
    expect(appointmentAgendaStatus({ startsAt: at(10), status: "compareceu" }, NOW)).toBe("compareceu");
    expect(appointmentAgendaStatus({ startsAt: at(16), status: "faltou" }, NOW)).toBe("faltou");
    expect(appointmentAgendaStatus({ startsAt: at(10), status: "cancelado" }, NOW)).toBe("cancelado");
    expect(STATUS_LABEL.cancelado).toBe("Cancelado");
  });
});

describe("Agenda: duração de cada horário", () => {
  it("usa a do horário; senão a do serviço; sem nenhuma, 60 min estimados", () => {
    expect(entryDuration(45, 90)).toEqual({ minutes: 45, estimated: false });
    expect(entryDuration(null, 90)).toEqual({ minutes: 90, estimated: false });
    expect(entryDuration(null, null)).toEqual({ minutes: 60, estimated: true });
    expect(entryDuration(0, null)).toEqual({ minutes: 60, estimated: true });
  });
});

describe("Agenda: minutos do dia e sobreposição na grade", () => {
  it("minuto do dia em Salvador e de um 'HH:MM'", () => {
    expect(minuteOfDay(new Date(Date.UTC(2026, 9, 14, 12, 30)).toISOString())).toBe(9 * 60 + 30);
    expect(minuteOfDay(new Date(Date.UTC(2026, 9, 15, 2, 0)).toISOString())).toBe(23 * 60);
    expect(hmToMinutes("13:15")).toBe(13 * 60 + 15);
    expect(hmToMinutes("lixo")).toBeNull();
  });
  it("horários que se sobrepõem dividem a coluna lado a lado", () => {
    const l = layoutLanes([
      { key: "a", start: 540, end: 600 },
      { key: "b", start: 570, end: 630 },
      { key: "c", start: 600, end: 660 }, // começa quando "a" termina: reaproveita a 1ª faixa
      { key: "d", start: 700, end: 760 }, // sozinho
    ]);
    expect(l.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(l.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(l.get("c")).toEqual({ lane: 0, lanes: 2 });
    expect(l.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});

describe("Agenda: duração por extenso", () => {
  it("30 min, 1h, 1h30, 2h15", () => {
    expect(durationLabel(30)).toBe("30 min");
    expect(durationLabel(60)).toBe("1h");
    expect(durationLabel(90)).toBe("1h30");
    expect(durationLabel(135)).toBe("2h15");
  });
  it("faixa de horário: início e fim em Salvador", () => {
    expect(timeRange(new Date(Date.UTC(2026, 9, 14, 12, 0)).toISOString(), 90)).toBe("09:00 – 10:30");
  });
});

describe("Pacotes: validade por extenso", () => {
  it("vence hoje, amanhã, em N dias; venceu; sem validade", () => {
    expect(validityLabel("2026-10-14", "2026-10-14")).toBe("vence hoje");
    expect(validityLabel("2026-10-15", "2026-10-14")).toBe("vence amanhã");
    expect(validityLabel("2026-11-13", "2026-10-14")).toBe("vence em 30 dias");
    expect(validityLabel("2026-10-03", "2026-10-14")).toBe("venceu em 03/10/2026");
    expect(validityLabel(null, "2026-10-14")).toBe("sem validade");
  });
});

describe("Agenda: status novos do 6B", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 14, h + 3)).toISOString();
  it("chegou, em atendimento e pedido do site valem como estão; Finalizado é o compareceu do banco", () => {
    expect(appointmentAgendaStatus({ startsAt: at(10), status: "chegou" }, NOW)).toBe("chegou");
    expect(appointmentAgendaStatus({ startsAt: at(10), status: "em_atendimento" }, NOW)).toBe("em_atendimento");
    expect(appointmentAgendaStatus({ startsAt: at(16), status: "solicitado" }, NOW)).toBe("solicitado");
    expect(STATUS_LABEL.compareceu).toBe("Finalizado");
    expect(STATUS_LABEL.em_atendimento).toBe("Em atendimento");
  });
  it("minuto do dia ↔ instante em Salvador", () => {
    expect(instantOf("2026-10-16", 600).toISOString()).toBe("2026-10-16T13:00:00.000Z");
    expect(instantOf("2026-10-31", 23 * 60 + 30).toISOString()).toBe("2026-11-01T02:30:00.000Z");
  });
});

describe("appointmentAgendaStatus e o status conferir (17/10)", () => {
  it("conferir fica conferir antes e depois da hora", () => {
    const now = new Date("2026-10-16T15:00:00Z");
    expect(appointmentAgendaStatus({ startsAt: "2026-10-17T15:00:00Z", status: "conferir" }, now)).toBe("conferir");
    expect(appointmentAgendaStatus({ startsAt: "2026-10-15T15:00:00Z", status: "conferir" }, now)).toBe("conferir");
  });
});
