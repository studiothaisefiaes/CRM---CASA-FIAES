import { it, expect } from "vitest";
import { groupByDay, historyEntries, type HistoryEvent, type HistoryLookup } from "./history";

const lookup: HistoryLookup = {
  users: { u1: "Ana Souza", u2: "Bia Lima" },
  lists: { s1: "Coloração", l1: "Preço" },
  sources: { src1: "Instagram bio" },
  stages: { followup_1: "Follow-up 1", agendado: "Agendado" },
};
// 2026-10-13 17:05 UTC = 14:05 em Salvador
const NOW = Date.parse("2026-10-13T17:05:00Z");
const ev = (id: string, type: string, payload: Record<string, unknown>, at: string, user: string | null = "Ana Souza"): HistoryEvent => ({ id, type, payload, createdAt: at, user });

it("mudança de campo mostra de/para com o nome do campo, o valor formatado, quem e a hora", () => {
  const [e] = historyEntries([ev("1", "campo_alterado", { campos: [{ campo: "valueCents", de: 10000, para: 15000 }] }, "2026-10-13T17:02:00Z")], lookup);
  expect(e.text).toBe("Valor: R$ 100,00 → R$ 150,00");
  expect(e.meta).toBe("Ana, 14:02");
});

it("cada campo vira uma linha; responsável, serviço e origem mostram nomes, não ids", () => {
  const es = historyEntries([ev("1", "responsavel_alterado", { campos: [{ campo: "ownerId", de: null, para: "u2" }, { campo: "serviceId", de: "s1", para: null }, { campo: "sourceId", de: null, para: "src1" }, { campo: "origin", de: "WhatsApp", para: "Indicação" }] }, "2026-10-13T17:02:00Z")], lookup);
  expect(es.map((e) => e.text)).toEqual(["Responsável: sem dono → Bia Lima", "Serviço: Coloração → vazio", "Origem: não identificada → Instagram bio", "Origem: não identificada → Indicação"]);
});

it("agendamento e comparecimento aparecem legíveis", () => {
  const es = historyEntries([
    ev("1", "campo_alterado", { campos: [{ campo: "scheduledAt", de: null, para: "2026-10-15T18:00:00.000Z" }] }, "2026-10-13T17:02:00Z"),
    ev("2", "comparecimento", { de: null, para: "faltou" }, "2026-10-13T17:03:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual(["Comparecimento: Faltou", "Agendamento: vazio → qui 15/10 às 15:00"]);
});

it("mensagens e 'lido' não entram: já estão na conversa", () => {
  const es = historyEntries([ev("1", "mensagem_recebida", {}, "2026-10-13T17:00:00Z"), ev("2", "mensagem_enviada", {}, "2026-10-13T17:01:00Z"), ev("3", "lido", {}, "2026-10-13T17:01:30Z"), ev("4", "assumiu", { de: null, para: "u1" }, "2026-10-13T17:02:00Z")], lookup);
  expect(es.map((e) => e.text)).toEqual(["Assumiu o lead"]);
});

it("tarefas: criada, concluída e cancelada, com o tipo", () => {
  const es = historyEntries([
    ev("1", "tarefa", { acao: "criada", tipo: "proxima_acao", titulo: "Mandar valores", para: "2026-10-14T13:00:00.000Z" }, "2026-10-13T17:00:00Z"),
    ev("2", "tarefa", { acao: "concluida", tipo: "proxima_acao", titulo: "Mandar valores" }, "2026-10-13T17:01:00Z"),
    ev("3", "tarefa", { acao: "cancelada", tipo: "comparecimento", titulo: "Conferir" }, "2026-10-13T17:02:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual(["Conferência cancelada: Conferir", "Próxima ação concluída: Mandar valores", "Próxima ação criada: Mandar valores · amanhã 10:00"]);
});

it("valor antigo sem de/para (lista de nomes) continua legível", () => {
  const [e] = historyEntries([ev("1", "campo_alterado", { campos: ["observations", "email"] }, "2026-10-13T17:00:00Z")], lookup);
  expect(e.text).toBe("Alterou Observações, E-mail");
});

it("texto longo é cortado no de/para", () => {
  const [e] = historyEntries([ev("1", "campo_alterado", { campos: [{ campo: "observations", de: null, para: "x".repeat(80) }] }, "2026-10-13T17:00:00Z")], lookup);
  expect(e.text.length).toBeLessThan(80);
  expect(e.text).toContain("…");
});

it("agrupa por dia de Salvador, do mais novo para o mais antigo (Hoje, Ontem, depois a data)", () => {
  const es = historyEntries([
    ev("1", "assumiu", {}, "2026-10-10T12:00:00Z"),
    ev("2", "assumiu", {}, "2026-10-13T01:30:00Z"), // 22h30 de 12/10 em Salvador: ontem, não hoje
    ev("3", "assumiu", {}, "2026-10-13T15:00:00Z"),
    ev("4", "assumiu", {}, "2026-10-13T16:00:00Z"),
  ], lookup);
  const days = groupByDay(es, NOW);
  expect(days.map((d) => [d.label, d.entries.length])).toEqual([["Hoje", 2], ["Ontem", 1], ["sábado, 10 de outubro", 1]]);
  expect(days[0].entries.map((e) => e.id)).toEqual(["4:0", "3:0"]);
});

it("etapa mostra o nome da etapa da lista, não a chave", () => {
  const es = historyEntries([ev("1", "etapa_alterada", { de: "lead", para: "followup_1", motivo: "manual" }, "2026-10-13T17:00:00Z"), ev("2", "etapa_alterada", { para: "inexistente", motivo: "manual" }, "2026-10-13T17:01:00Z")], lookup);
  expect(es.map((e) => e.text)).toEqual(["Movido para Inexistente", "Movido para Follow-up 1"]);
});
