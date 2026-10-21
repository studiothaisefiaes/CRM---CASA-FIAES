import { it, expect } from "vitest";
import { signalsOf, signalLabels, SIGNAL_LABEL } from "./signals";
const m = (direction: "in" | "out", body: string, min: number) => ({ direction, body, createdAt: new Date(Date.UTC(2026, 9, 13, 13, min)) });
it("pediu preço e horário, com acento e variações", () => {
  expect(signalsOf([m("in", "Quanto custa a hidratação?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "qual o VALOR?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "tem horário sábado?", 0)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "tem vaga amanha de manhã", 0)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "bom dia, tudo bem?", 0)])).toEqual([]);
});
it("não confunde: 'quanto tempo', tabela de horários, endereço", () => {
  expect(signalsOf([m("in", "quanto tempo dura?", 0)])).not.toContain("pediu_preco");
  expect(signalsOf([m("in", "qual a tabela de horários?", 0)])).not.toContain("pediu_preco");
  expect(signalsOf([m("in", "qual a tabela de horários?", 0)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "qual o custo da progressiva?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "quanto é a escova?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "tabela de preços?", 0)])).toContain("pediu_preco");
  const longe = new Date(Date.UTC(2026, 9, 20));
  expect(signalsOf([m("out", "A gente fica na Rua das Flores, 123", 0)], longe)).not.toContain("sumiu_apos_preco");
  expect(signalsOf([m("out", "Fica no 2º andar, sala 12", 0)], longe)).not.toContain("sumiu_apos_preco");
});
it("sumiu depois do preço: Casa mandou valor e cliente não respondeu há > 24 h", () => {
  const msgs = [m("in", "quanto é?", 0), m("out", "A avaliação é R$ 150", 2)];
  expect(signalsOf(msgs, new Date(Date.UTC(2026, 9, 14, 14, 0)))).toContain("sumiu_apos_preco");
  expect(signalsOf(msgs, new Date(Date.UTC(2026, 9, 14, 12, 0)))).not.toContain("sumiu_apos_preco");
  expect(signalsOf([...msgs, m("in", "vou ver", 30)], new Date(Date.UTC(2026, 9, 20)))).not.toContain("sumiu_apos_preco");
  expect(signalsOf([m("out", "Fica 150 reais o pacote", 0)], new Date(Date.UTC(2026, 9, 20)))).toContain("sumiu_apos_preco");
});
it("pediu preço some quando a Casa manda um valor; volta se ela perguntar de novo", () => {
  expect(signalsOf([m("in", "quanto custa a escova?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "quanto custa a escova?", 0), m("out", "A escova é R$ 80", 1)])).not.toContain("pediu_preco");
  expect(signalsOf([m("in", "quanto custa a escova?", 0), m("out", "Oi! Já te passo", 1)])).toContain("pediu_preco"); // respondeu sem valor
  expect(signalsOf([m("in", "quanto custa a escova?", 0), m("out", "R$ 80", 1), m("in", "e qual o valor da hidratação?", 2)])).toContain("pediu_preco");
});
it("pediu horário some quando a Casa oferece um horário", () => {
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Temos sábado às 14h", 1)])).not.toContain("pediu_horario");
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Pode ser 15:30?", 1)])).not.toContain("pediu_horario");
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Vou ver a agenda", 1)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "tem horário sábado?", 0), m("out", "Fica R$ 150", 1)])).toContain("pediu_horario"); // valor não é horário
});
it("'Responde rápido' não existe mais (era ruído)", () => {
  expect(signalsOf([m("out", "Oi!", 0), m("in", "oi", 1)])).toEqual([]);
  expect(Object.values(SIGNAL_LABEL)).not.toContain("Responde rápido");
});
it("rótulos curtos, no máximo 2, na ordem de prioridade", () => {
  const all = signalsOf([m("in", "estragou meu cabelo, é urgente, quanto custa arrumar?", 0)]);
  expect(all.slice(0, 3)).toEqual(["reclamacao", "urgente", "pediu_preco"]);
  expect(signalLabels(all)).toEqual(["Reclamação", "Urgente"]);
});
