import { describe, expect, it } from "vitest";
import {
  normText, normHeader, splitClientName, moneyCents, dateIso, timeHm, bahiaAt, reservationStatus, weekdaysOf, intOrNull, comandaOf, durationMin, itemKind, pctOrNull,
} from "./normalize";

describe("normalize (Avec)", () => {
  it("normText: sem acento, minúsculas, sem o parêntese final, espaços únicos", () => {
    expect(normText("  Ana  Cláudia Rapatoni (T. USO DE IMAGEM) ")).toBe("wanda rezende gomes");
    expect(normText("CORTE  FEMININO")).toBe("corte feminino");
    expect(normText(null)).toBe("");
  });
  it("normHeader: cabeçalho sem acento e minúsculo (mantém o parêntese)", () => {
    expect(normHeader(" Comissão (%) ")).toBe("comissao (%)");
    expect(normHeader("Última Visita")).toBe("ultima visita");
  });
  it("splitClientName: tira o sufixo e reconhece uso de imagem (com e sem espaço)", () => {
    expect(splitClientName("Wanda Rezende Gomes (T. USO DE IMAGEM)")).toMatchObject({ name: "Wanda Rezende Gomes", imageUse: true });
    expect(splitClientName("Rita (T.USO DE IMAGEM)")).toMatchObject({ name: "Rita", imageUse: true });
    expect(splitClientName("Bia (indicação da Rita)")).toMatchObject({ name: "Bia", imageUse: false });
    expect(splitClientName("  Sol   Lua ")).toMatchObject({ name: "Sol Lua", imageUse: false });
    expect(splitClientName("")).toMatchObject({ name: null, imageUse: false });
  });
  it("moneyCents: número em reais (150 = R$ 150,00) e texto pt-BR", () => {
    expect(moneyCents("150")).toBe(15000);
    expect(moneyCents("89.9")).toBe(8990);
    expect(moneyCents("R$ 1.158,50")).toBe(115850);
    expect(moneyCents("-20")).toBe(-2000);
    expect(moneyCents("")).toBeNull();
    expect(moneyCents("abc")).toBeNull();
  });
  it("dateIso: dd/mm/aaaa (com ou sem hora) e aaaa-mm-dd", () => {
    expect(dateIso("01/10/2026")).toBe("2026-10-01");
    expect(dateIso("1/2/2026 10:00")).toBe("2026-02-01");
    expect(dateIso("2026-10-01 10:28:39")).toBe("2026-10-01");
    expect(dateIso("31/02/2026")).toBeNull();
    expect(dateIso("")).toBeNull();
  });
  it("timeHm e bahiaAt: horário de Salvador (UTC-3)", () => {
    expect(timeHm("9:05")).toBe("09:05");
    expect(timeHm("14:30:00")).toBe("14:30");
    expect(timeHm("25:00")).toBeNull();
    expect(bahiaAt("2026-10-14", "09:30").toISOString()).toBe("2026-10-14T12:30:00.000Z");
  });
  it("reservationStatus: status do Avec para o nosso; desconhecido vira conferir (neutro) e guarda o original", () => {
    expect(reservationStatus("Agendado")).toEqual({ status: "agendado", avecStatus: null });
    expect(reservationStatus("Confirmado")).toEqual({ status: "confirmado", avecStatus: null });
    for (const s of ["Pago", "Atendido", "Finalizado", "Em atendimento"]) expect(reservationStatus(s).status).toBe("compareceu");
    expect(reservationStatus("Não compareceu").status).toBe("faltou");
    expect(reservationStatus("Faltou").status).toBe("faltou");
    expect(reservationStatus("Cancelado").status).toBe("cancelado");
    expect(reservationStatus("Aguardando sinal")).toEqual({ status: "conferir", avecStatus: "Aguardando sinal" });
    expect(reservationStatus("Aguardando")).toEqual({ status: "conferir", avecStatus: "Aguardando" });
    expect(reservationStatus(" Desmarcado ")).toEqual({ status: "conferir", avecStatus: "Desmarcado" });
    expect(reservationStatus("")).toEqual({ status: "agendado", avecStatus: null });
  });
  it("weekdaysOf: 'Terça,' e listas separadas por vírgula (0=dom..6=sáb); vazio = todos os dias", () => {
    expect(weekdaysOf("Terça,")).toEqual([2]);
    expect(weekdaysOf("Segunda, Quarta, Sábado")).toEqual([1, 3, 6]);
    expect(weekdaysOf("Domingo,Domingo")).toEqual([0]);
    expect(weekdaysOf("")).toBeNull();
  });
  it("números: inteiro, comanda e duração", () => {
    expect(intOrNull("10")).toBe(10);
    expect(intOrNull("x")).toBeNull();
    expect(comandaOf("1234")).toBe("1234");
    expect(comandaOf("1234.0")).toBe("1234");
    expect(comandaOf("")).toBeNull();
    expect(durationMin("01:30")).toBe(90);
    expect(durationMin("45")).toBe(45);
    expect(durationMin("1 hora")).toBeNull();
  });
  it("itemKind: Serviço/Produto/Pacote", () => {
    expect(itemKind("Serviço")).toBe("servico");
    expect(itemKind("PRODUTO")).toBe("produto");
    expect(itemKind("Pacote")).toBe("pacote");
    expect(itemKind("Vale presente")).toBe("outro");
    expect(itemKind("")).toBe("outro");
  });
});

describe("pctOrNull", () => {
  it("lê a % da comissão do Avec; fora de 0 a 100 ou texto, nada", () => {
    expect(pctOrNull("40")).toBe(40);
    expect(pctOrNull("40,5")).toBe(40.5);
    expect(pctOrNull(" 35 % ")).toBe(35);
    expect(pctOrNull("0")).toBe(0);
    expect(pctOrNull("101")).toBeNull();
    expect(pctOrNull("abc")).toBeNull();
    expect(pctOrNull("")).toBeNull();
  });
});

describe("plausibleDay (17/10: o Avec mandou horários em 2029, 2923 e 4676)", () => {
  it("aceita de 2000 até um ano (366 dias) depois de hoje em Salvador", async () => {
    const { plausibleDay } = await import("./normalize");
    const now = new Date("2026-10-17T12:00:00Z");
    expect(plausibleDay("4676-11-10", now)).toBe(false);
    expect(plausibleDay("2923-01-01", now)).toBe(false);
    expect(plausibleDay("2029-01-01", now)).toBe(false);
    expect(plausibleDay("2027-10-18", now)).toBe(true);
    expect(plausibleDay("2027-10-19", now)).toBe(false);
    expect(plausibleDay("2020-01-17", now)).toBe(true);
    expect(plausibleDay("1999-12-31", now)).toBe(false);
  });
});

describe("splitClientName e o (completar cadastro) (17/10)", () => {
  it("marca completeProfile; o parêntese fechado já saía do nome, o resto fica (a chave da reserva não muda)", () => {
    expect(splitClientName("ANA LIMA (COMPLETAR CADASTRO)")).toEqual({ name: "ANA LIMA", imageUse: false, completeProfile: true });
    expect(splitClientName("MARIA SOUZA COMPLETAR")).toEqual({ name: "MARIA SOUZA COMPLETAR", imageUse: false, completeProfile: true });
    expect(splitClientName("Bia (T. USO DE IMAGEM)")).toEqual({ name: "Bia", imageUse: true, completeProfile: false });
  });
});
