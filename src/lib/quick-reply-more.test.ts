import { describe, expect, it } from "vitest";
import { REPLY_VAR_HELP, fillVar, pendingVars, renderReply } from "./quick-reply";

const FULL = { primeiroNome: "Maria", dataHorario: "qui 22/10 às 15:00", profissional: "Maiara", servico: "Corte", meuNome: "Sara" };

describe("respostas prontas: {servico} e {meu_nome}", () => {
  it("troca o serviço do horário e o nome de quem envia", () => {
    expect(renderReply("Oi! Aqui é a {meu_nome}. Seu {servico} está confirmado.", FULL).text).toBe("Oi! Aqui é a Sara. Seu Corte está confirmado.");
  });
  it("sem serviço, {servico} fica no texto e volta como faltando", () => {
    expect(renderReply("Seu {servico}", { ...FULL, servico: null })).toEqual({ text: "Seu {servico}", missing: ["serviço"] });
  });
  it("os botões de variável oferecem as seis", () => {
    expect(REPLY_VAR_HELP.map((v) => v.token)).toEqual(["{primeiro_nome}", "{saudacao}", "{data_horario}", "{profissional}", "{servico}", "{meu_nome}"]);
  });
});

describe("variável sem dado vira campo para preencher", () => {
  it("lista as variáveis que ficaram no texto, uma vez cada, com o rótulo", () => {
    expect(pendingVars("{data_horario} com {profissional}, {data_horario}")).toEqual([
      { key: "data_horario", label: "data e horário" }, { key: "profissional", label: "profissional" },
    ]);
    expect(pendingVars("Tudo certo, {preco}")).toEqual([]);
  });
  it("preencher troca todas as ocorrências pelo valor digitado (sem espaços sobrando)", () => {
    expect(fillVar("{data_horario}, ok? {data_horario}", "data_horario", "  sáb 24/10 às 10:30 ")).toBe("sáb 24/10 às 10:30, ok? sáb 24/10 às 10:30");
  });
  it("valor vazio não troca nada", () => {
    expect(fillVar("{servico}", "servico", "   ")).toBe("{servico}");
  });
});
