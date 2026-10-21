import { describe, expect, it } from "vitest";
import { isGenericClientName } from "./generic-client";
import { visitColumn, visitLateMin, visitProgress, visitTotal, passedText, serviceView, dayTableVisits, visitSituation, visitAction, dayNumbers, type DayVisit, type DayVisitService } from "./day-visit";

const at = (hm: string) => new Date(`2026-10-17T${hm}:00-03:00`).toISOString();
let n = 0;
const s = (status: string, o: Partial<DayVisitService> = {}): DayVisitService => ({
  appointmentId: `a${++n}`, serviceId: null, service: "Corte", professionalId: "p", pro: "Ana", assistant: null, start: at("09:00"), end: at("10:00"), status, priceCents: 10000, ...o,
});
const c = (services: DayVisitService[], o: Partial<DayVisit> = {}): DayVisit => ({
  key: "k", visitId: "v", contactId: "c", dealId: null, name: "Paula", day: "2026-10-17", entry: services[0]?.start ?? at("09:00"), services, cancelled: [], comanda: null, values: true, ...o,
});

describe("visita do dia (17/10: uma por cliente, nunca repetida por serviço)", () => {
  it("coluna do quadro: a chegar, na Casa, finalizou e não veio", () => {
    expect(visitColumn(c([s("agendado"), s("confirmado")]))).toBe("a_chegar");
    expect(visitColumn(c([s("chegou"), s("agendado")]))).toBe("na_casa");
    expect(visitColumn(c([s("compareceu"), s("em_atendimento")]))).toBe("na_casa");
    expect(visitColumn(c([s("compareceu"), s("agendado")]))).toBe("na_casa"); // já atendida num, falta outro
    expect(visitColumn(c([s("compareceu"), s("compareceu")]))).toBe("finalizou");
    expect(visitColumn(c([s("compareceu"), s("faltou")]))).toBe("finalizou");
    expect(visitColumn(c([s("faltou")]))).toBe("nao_veio");
    expect(visitColumn(c([], { cancelled: [s("cancelado")] }))).toBe("nao_veio");
  });

  it("atrasada só em 'a chegar', depois da hora de entrada; texto em horas e minutos", () => {
    const now = new Date(at("11:30")).getTime();
    expect(visitLateMin(c([s("confirmado")]), now)).toBe(150);
    expect(visitLateMin(c([s("chegou")]), now)).toBeNull();
    expect(visitLateMin(c([s("agendado", { start: at("11:40") })]), now)).toBeNull();
    expect(passedText(150)).toBe("passou 2h30");
    expect(passedText(60)).toBe("passou 1h");
    expect(passedText(20)).toBe("passou 20 min");
  });

  it("total só com preço; conta o que falta preço; progresso", () => {
    expect(visitTotal(c([s("agendado"), s("agendado", { priceCents: 5000 })]))).toEqual({ totalCents: 15000, missing: 0 });
    expect(visitTotal(c([s("agendado", { priceCents: null }), s("agendado", { priceCents: 5000 })]))).toEqual({ totalCents: 5000, missing: 1 });
    expect(visitTotal(c([s("agendado", { priceCents: null })]))).toEqual({ totalCents: null, missing: 1 });
    expect(visitProgress(c([s("compareceu"), s("em_atendimento"), s("chegou")]))).toEqual({ done: 1, running: 1, total: 3 });
  });

  it("cor de cada serviço pelas cores da Agenda", () => {
    expect(["agendado", "solicitado", "confirmado", "chegou", "em_atendimento", "compareceu", "faltou", "cancelado"].map(serviceView))
      .toEqual(["marcado", "pedido", "confirmado", "chegou", "atendendo", "finalizado", "faltou", "cancelado"]);
  });
});

describe("Hoje v3: a tabela do dia (protótipo aprovado em 17/10)", () => {
  const DAY = "2026-10-17";
  const now = (hm: string) => new Date(at(hm)).getTime();

  it("CLIENTE PADRÃO do Avec é reconhecida sem maiúsculas nem acento", () => {
    for (const n of ["CLIENTE PADRÃO", "Cliente Padrao", " cliente padrão "]) expect(isGenericClientName(n)).toBe(true);
    expect(isGenericClientName("Cliente Paula")).toBe(false);
  });

  it("fora da tabela: CLIENTE PADRÃO, espera às 00:00 e cancelado de outro dia; cancelado hoje fica como Não veio", () => {
    const padrao = c([s("confirmado")], { key: "p", name: "CLIENTE PADRÃO" });
    const soEspera = c([s("espera", { start: at("00:00") })], { key: "e" });
    const misto = c([s("agendado", { start: at("00:00") }), s("confirmado", { start: at("10:00") })], { key: "m", entry: at("00:00") });
    const cancelOntem = c([], { key: "co", cancelled: [s("cancelado", { start: at("14:00"), cancelledAt: "2026-10-16T15:00:00.000Z" })], entry: at("14:00") });
    const cancelHoje = c([], { key: "ch", cancelled: [s("cancelado", { start: at("15:00"), cancelledAt: new Date(at("08:00")).toISOString() })], entry: at("15:00") });
    const out = dayTableVisits([padrao, soEspera, misto, cancelOntem, cancelHoje], DAY);
    expect(out.map((v) => v.key)).toEqual(["m", "ch"]);
    expect(out[0].services).toHaveLength(1);
    expect(out[0].entry).toBe(at("10:00"));
    expect(visitColumn(out[1])).toBe("nao_veio");
  });

  it("situação: Confirmada/Marcada, passou da hora sem Chegou, Na Casa desde, Finalizou (falta pagar só com caixa), Não veio", () => {
    expect(visitSituation(c([s("confirmado", { start: at("13:00") })]), now("11:00"), { caixaOn: false })).toMatchObject({ label: "Confirmada", late: false });
    expect(visitSituation(c([s("agendado", { start: at("13:00") }), s("confirmado", { start: at("14:00") })]), now("11:00"), { caixaOn: false }).label).toBe("Marcada");
    expect(visitSituation(c([s("confirmado", { start: at("10:00") })]), now("12:47"), { caixaOn: false })).toMatchObject({ label: "passou 2h47, sem Chegou", late: true, tone: null });
    const casa = c([s("em_atendimento", { arrivedAt: at("09:10") }), s("compareceu", { arrivedAt: at("09:40") }), s("chegou")]);
    expect(visitSituation(casa, now("11:00"), { caixaOn: false })).toMatchObject({ label: "Na Casa desde 09:10", detail: "1 de 3 finalizados" });
    expect(visitSituation(c([s("chegou", { arrivedAt: at("09:10") })]), now("11:00"), { caixaOn: false }).detail).toBeNull();
    const fim = c([s("compareceu")], { comanda: { id: "x", number: 3, status: "aberta" } });
    expect(visitSituation(fim, now("11:00"), { caixaOn: true })).toMatchObject({ label: "Finalizado", detail: "falta pagar" });
    expect(visitSituation({ ...fim, comanda: { id: "x", number: 3, status: "fechada" } }, now("11:00"), { caixaOn: true }).detail).toBe("paga");
    expect(visitSituation(fim, now("11:00"), { caixaOn: false }).detail).toBeNull();
    expect(visitSituation(c([s("faltou")]), now("11:00"), { caixaOn: false }).label).toBe("Não veio");
  });

  it("ação na linha: Chegou para quem vai chegar, Receber só com caixa e permissão, senão Abrir", () => {
    expect(visitAction(c([s("confirmado")]), { caixaOn: true, canReceive: true })).toBe("chegou");
    const fim = c([s("compareceu")]);
    expect(visitAction(fim, { caixaOn: true, canReceive: true })).toBe("receber");
    expect(visitAction(fim, { caixaOn: true, canReceive: false })).toBe("abrir");
    expect(visitAction(fim, { caixaOn: false, canReceive: true })).toBe("abrir");
    expect(visitAction({ ...fim, comanda: { id: "x", number: 1, status: "fechada" } }, { caixaOn: true, canReceive: true })).toBe("abrir");
    expect(visitAction(c([s("chegou")]), { caixaOn: true, canReceive: true })).toBe("abrir");
  });

  it("números do dia: faltam pagar só com caixa; as 2 próximas chegadas, sem as atrasadas", () => {
    const vs = [
      c([s("confirmado", { start: at("10:00") })], { key: "late" }),
      c([s("confirmado", { start: at("13:00") })], { key: "n1" }),
      c([s("agendado", { start: at("13:30") })], { key: "n2" }),
      c([s("agendado", { start: at("16:00") })], { key: "n3" }),
      c([s("chegou")], { key: "casa" }),
      c([s("compareceu")], { key: "fim1" }),
      c([s("compareceu")], { key: "fim2", comanda: { id: "y", number: 2, status: "fechada" } }),
      c([s("faltou")], { key: "nv" }),
    ];
    const n = dayNumbers(vs, now("12:00"), { caixaOn: true });
    expect(n).toMatchObject({ total: 8, inHouse: 1, toCome: 4, done: 2, toPay: 1, noShow: 1 });
    expect(n.next.map((v) => v.key)).toEqual(["n1", "n2"]);
    expect(dayNumbers(vs, now("12:00"), { caixaOn: false }).toPay).toBeNull();
  });
});
