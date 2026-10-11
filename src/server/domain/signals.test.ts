import { it, expect } from "vitest";
import { signalsOf, signalLabels } from "./signals";
const m = (direction: "in" | "out", body: string, min: number) => ({ direction, body, createdAt: new Date(Date.UTC(2026, 9, 13, 13, min)) });
it("pediu preço e horário, com acento e variações", () => {
  expect(signalsOf([m("in", "Quanto custa a hidratação?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "qual o VALOR?", 0)])).toContain("pediu_preco");
  expect(signalsOf([m("in", "tem horário sábado?", 0)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "tem vaga amanha de manhã", 0)])).toContain("pediu_horario");
  expect(signalsOf([m("in", "bom dia, tudo bem?", 0)])).toEqual([]);
});
it("sumiu depois do preço: Casa mandou valor e cliente não respondeu há > 24 h", () => {
  const msgs = [m("in", "quanto é?", 0), m("out", "A avaliação é R$ 150", 2)];
  expect(signalsOf(msgs, new Date(Date.UTC(2026, 9, 14, 14, 0)))).toContain("sumiu_apos_preco");
  expect(signalsOf(msgs, new Date(Date.UTC(2026, 9, 14, 12, 0)))).not.toContain("sumiu_apos_preco");
  expect(signalsOf([...msgs, m("in", "vou ver", 30)], new Date(Date.UTC(2026, 9, 20)))).not.toContain("sumiu_apos_preco");
  expect(signalsOf([m("out", "Fica 150 reais o pacote", 0)], new Date(Date.UTC(2026, 9, 20)))).toContain("sumiu_apos_preco");
});
it("respondeu rápido: cliente respondeu em < 2 min à Casa", () => {
  expect(signalsOf([m("out", "Oi!", 0), m("in", "oi", 1)])).toContain("respondeu_rapido");
  expect(signalsOf([m("out", "Oi!", 0), m("in", "oi", 5)])).not.toContain("respondeu_rapido");
});
it("rótulos curtos, no máximo 2, na ordem de prioridade", () => {
  const all = signalsOf([m("in", "quanto custa? tem horário?", 0), m("out", "R$ 90", 1), m("in", "ok", 2)], new Date(Date.UTC(2026, 9, 20)));
  expect(signalLabels(all)).toHaveLength(2);
  expect(signalLabels(["pediu_preco"])).toEqual(["Pediu preço"]);
});
