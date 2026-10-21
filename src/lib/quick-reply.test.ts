import { describe, expect, it } from "vitest";
import { greetingAt, missingVars, renderReply, replyTitle } from "./quick-reply";

const V = { primeiroNome: "Maria", dataHorario: "qui 22/10 às 15:00", profissional: "Maiara" };
const MORNING = Date.parse("2026-10-20T12:00:00Z"); // 9:00 em Salvador

describe("respostas prontas: variáveis", () => {
  it("troca nome, data/horário, profissional e saudação", () => {
    expect(renderReply("{saudacao}, {primeiro_nome}! Confirmando {data_horario} com {profissional}.", V, MORNING))
      .toEqual({ text: "Bom dia, Maria! Confirmando qui 22/10 às 15:00 com Maiara.", missing: [] });
  });
  it("{nome} antigo continua valendo como primeiro nome", () => {
    expect(renderReply("Oi, {nome}!", V).text).toBe("Oi, Maria!");
  });
  it("nome desconhecido some sem deixar vírgula sobrando", () => {
    expect(renderReply("Oi, {primeiro_nome}!", { ...V, primeiroNome: null }).text).toBe("Oi!");
  });
  it("data/horário e profissional sem valor ficam no texto e voltam como faltando: nunca vão crus para a cliente", () => {
    expect(renderReply("Confirmando {data_horario} com {profissional}", { primeiroNome: "Maria", dataHorario: null, profissional: null }))
      .toEqual({ text: "Confirmando {data_horario} com {profissional}", missing: ["data e horário", "profissional"] });
  });
  it("chave desconhecida fica como está e as quebras de linha são mantidas", () => {
    expect(renderReply("Linha 1\n\nValor: {preco}", V).text).toBe("Linha 1\n\nValor: {preco}");
  });
  it("saudação pela hora de Salvador", () => {
    expect(greetingAt(Date.parse("2026-10-20T14:59:00Z"))).toBe("Bom dia"); // 11:59
    expect(greetingAt(Date.parse("2026-10-20T15:00:00Z"))).toBe("Boa tarde"); // 12:00
    expect(greetingAt(Date.parse("2026-10-20T21:00:00Z"))).toBe("Boa noite"); // 18:00
  });
  it("na hora de enviar, acusa qualquer variável que ficou no texto", () => {
    expect(missingVars("Oi! Seu horário é {data_horario}")).toEqual(["data e horário"]);
    expect(missingVars("Tudo certo, {preco}")).toEqual([]);
  });
});

describe("replyTitle (nome legível da resposta pronta, P12)", () => {
  it("o atalho vira um nome com acento e maiúscula; hífen de palavra composta fica", () => {
    expect(replyTitle("pos-atendimento")).toBe("Pós-atendimento");
    expect(replyTitle("avaliacao")).toBe("Avaliação");
    expect(replyTitle("boas-vindas")).toBe("Boas-vindas");
    expect(replyTitle("fotos-cabelo")).toBe("Fotos do cabelo");
    expect(replyTitle("endereco")).toBe("Endereço");
    expect(replyTitle("aniversario")).toBe("Aniversário");
    expect(replyTitle("confirmar")).toBe("Confirmar");
    expect(replyTitle("horario_de_funcionamento")).toBe("Horário de funcionamento");
  });
  it("nome já escrito pela equipe (com espaço ou maiúscula) fica como está", () => {
    expect(replyTitle("Promoção de outubro")).toBe("Promoção de outubro");
  });
});
