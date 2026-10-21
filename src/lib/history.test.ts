import { describe, it, expect } from "vitest";
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
  expect(es.map((e) => e.text)).toEqual(["Assumiu a conversa"]);
});

it("tarefas: criada, concluída e cancelada, com o tipo", () => {
  const es = historyEntries([
    ev("1", "tarefa", { acao: "criada", tipo: "proxima_acao", titulo: "Mandar valores", para: "2026-10-14T13:00:00.000Z" }, "2026-10-13T17:00:00Z"),
    ev("2", "tarefa", { acao: "concluida", tipo: "proxima_acao", titulo: "Mandar valores" }, "2026-10-13T17:01:00Z"),
    ev("3", "tarefa", { acao: "cancelada", tipo: "comparecimento", titulo: "Conferir" }, "2026-10-13T17:02:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual(["Conferência cancelada: Conferir", "Combinado concluído: Mandar valores", "Combinado criado: Mandar valores · amanhã 10:00"]);
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

describe("distribuição no histórico", () => {
  const t = (type: string, payload: Record<string, unknown>) => historyEntries([ev("1", type, payload, "2026-10-13T17:00:00Z")], lookup)[0]?.text;
  it("conta para quem a conversa foi e por quê", () => {
    expect(t("distribuido", { para: "u1", motivo: "prioridade" })).toBe("Distribuído para Ana Souza");
    expect(t("distribuido", { para: "u2", motivo: "retorno" })).toBe("Distribuído para Bia Lima (atendeu da última vez)");
    expect(t("distribuido", { para: null, motivo: "ninguem_livre" })).toBe("Ninguém disponível: ficou na fila sem dona");
    expect(t("distribuido", { para: "u1", motivo: "fila" })).toBe("Distribuído para Ana Souza (estava na fila sem dona)");
    expect(t("oferecido", { para: "u2" })).toBe("Oferecido para Bia Lima assumir");
    expect(t("devolvido_a_fila", { de: "u1", motivo: "ausente" })).toBe("Voltou para a fila (Ana Souza ficou ausente)");
    expect(t("devolvido_a_fila", { de: "u1", motivo: "pausa" })).toBe("Voltou para a fila (Ana Souza entrou em pausa)");
    expect(t("assumiu", { de: "u1", para: "u2", porOferta: true })).toBe("Assumiu a conversa pela oferta");
  });
});

it("dona pela assinatura do celular fica explicada (inclusive no acerto das conversas antigas)", () => {
  const es = historyEntries([
    ev("1", "assumiu", { de: null, para: "u1", motivo: "assinatura" }, "2026-10-13T17:02:00Z"),
    ev("2", "assumiu", { de: null, para: "u1", motivo: "assinatura", migracao: true }, "2026-10-13T17:03:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual([
    "Virou a dona: respondeu assinando pelo celular (acerto das conversas antigas)",
    "Virou a dona: respondeu assinando pelo celular",
  ]);
  expect(historyEntries([ev("3", "assumiu", { de: null, para: "u1", motivo: "resposta_crm" }, "2026-10-13T17:05:00Z")], lookup).map((e) => e.text))
    .toEqual(["Virou a dona: respondeu pelo CRM"]);
});

it("códigos do sistema viram frases (nada de conversa_arquivada na tela)", () => {
  const es = historyEntries([
    ev("1", "conversa_arquivada", {}, "2026-10-13T17:00:00Z"),
    ev("2", "conversa_desarquivada", { motivo: "cliente_escreveu" }, "2026-10-13T17:01:00Z", null),
    ev("3", "contato_mesclado", { lid: "1020" }, "2026-10-13T17:02:00Z", null),
    ev("4", "espera_virou_followup", { etapaAntes: "lead" }, "2026-10-13T17:03:00Z", null),
    ev("5", "espera_encerrada_agradecimento", { mensagens: 1 }, "2026-10-13T17:04:00Z", null),
    ev("6", "retomar_depois", { dueAt: "2026-10-14T13:00:00.000Z", etapaAntes: "atendimento" }, "2026-10-13T17:05:00Z"),
    ev("7", "codigo_que_nao_existe", {}, "2026-10-13T17:06:00Z", null),
    ev("8", "conversa_desarquivada", { motivo: "manual" }, "2026-10-13T17:07:00Z"),
  ], lookup);
  expect(es.map((e) => e.text)).toEqual([
    "Conversa reaberta",
    "Outro registro do sistema",
    "Retomar depois: lembrete para amanhã 10:00",
    "Espera encerrada: a cliente só agradeceu",
    "Ninguém respondeu até o fim do dia: virou follow-up",
    "Contatos juntados (mesmo número)",
    "Conversa reaberta: a cliente escreveu",
    "Conversa resolvida (saiu da lista)",
  ]);
  for (const e of es) expect(e.text).not.toMatch(/^[a-z]+(_[a-z]+)+$/);
});

it("funil novo: motivos e passos em português (nunca o código)", () => {
  const es = historyEntries([
    ev("1", "etapa_alterada", { de: "atendimento", para: "followup_1", motivo: "automacao:casa_falou_4h" }, "2026-10-13T17:00:00Z"),
    ev("2", "etapa_alterada", { de: "agendado", para: "atendida", motivo: "avec_compareceu" }, "2026-10-13T17:01:00Z"),
    ev("3", "etapa_alterada", { de: "followup_1", para: "perdido", motivo: "nao_respondeu" }, "2026-10-13T17:02:00Z"),
    ev("4", "tentativa", { feita: 2, por: "mensagem" }, "2026-10-13T17:03:00Z"),
    ev("5", "aguardando_cliente", { automatico: true }, "2026-10-13T17:04:00Z"),
    ev("6", "orcamento_enviado", {}, "2026-10-13T17:05:00Z"),
  ], { ...lookup, stages: { followup_1: "Aguardando cliente", atendida: "Atendida", perdido: "Perdido" } });
  expect(es.map((e) => e.text)).toEqual([
    "Orçamento enviado",
    "Marcado como aguardando cliente (tentativas automáticas)",
    "Tentativa 2 de 3 feita (mensagem da Casa)",
    "Movido para Perdido (3 tentativas sem resposta)",
    "Movido para Atendida (veio, pelo Avec)",
    "Movido para Aguardando cliente (automático)",
  ]);
});

it("convite de retorno (mensagem em massa) aparece explicado no histórico", () => {
  const es = historyEntries([
    ev("1", "conversa_desarquivada", { motivo: "convite_retorno" }, "2026-10-13T17:00:00Z", null),
    ev("2", "convite_retorno", { messageId: "m1" }, "2026-10-13T17:00:01Z", null),
    ev("3", "conversa_arquivada", { motivo: "convite_sem_resposta", dias: 14 }, "2026-10-27T17:00:00Z", null),
  ], lookup);
  expect(es.map((e) => e.text).sort()).toEqual([
    "Conversa reaberta pelo convite de retorno",
    "Conversa resolvida: 14 dias sem resposta ao convite de retorno",
    "Convite de retorno enviado (mensagem em massa): aguardando a cliente",
  ]);
});

it("o que a cliente fez pelo link aparece com frase, nunca com o código", () => {
  const at = "2026-10-15T13:42:00Z";
  const lk = { users: {}, lists: {}, sources: {} };
  const t = (payload: Record<string, unknown>) => historyEntries([{ id: "e1", type: "link_cliente", payload, createdAt: at, user: null }], lk)[0].text;
  expect(t({ acao: "confirmou" })).toBe("Confirmou pelo link");
  expect(t({ acao: "cancelou", motivo: "Imprevisto" })).toBe("Cancelou pelo link (Imprevisto)");
  expect(t({ acao: "pediu_remarcar", sugestao: "sábado de manhã" })).toBe("Pediu para remarcar pelo link: sábado de manhã");
});

it("conversa criada pelo Retorno sugerido aparece como Hora de voltar", () => {
  const es = historyEntries([ev("o1", "lead_criado", { origin: "Retorno sugerido" }, "2026-10-13T12:00:00Z")], lookup);
  expect(es.map((e) => e.text)).toEqual(["Conversa criada (Hora de voltar)"]);
});
