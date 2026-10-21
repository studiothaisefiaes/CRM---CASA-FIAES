import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, formAnswers, formQuestions, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { saveFuncoes } from "./funcoes";
import { fichaOf, listQuestions, moveQuestion, saveAnswer, saveQuestion, setQuestionActive } from "./fichas";

let u: string, c: string, c2: string;
let cor: string, rotina: string, nome: string, obs: string; // opcao/caixas/texto/texto_longo
const visita = async (contactId: string, day: string) => (await db.insert(visits).values({ contactId, day }).returning())[0].id;
const answers = () => db.select().from(formAnswers);

beforeEach(async () => {
  await resetDb();
  const s = await setupAgenda();
  u = s.gestora.id; c = (await cliente("Paula Souza")).contactId; c2 = (await cliente("Marina Lopes")).contactId;
  rotina = (await saveQuestion({ form: "anamnese", label: "Como é sua rotina?", kind: "opcao", options: ["Corrida", "Tranquila"] }, u)).id;
  cor = (await saveQuestion({ form: "anamnese", label: "Você já utilizou:", kind: "caixas", options: ["Coloração", "Progressiva", "Outro"] }, u)).id;
  nome = (await saveQuestion({ form: "campos", label: "Apelido", kind: "texto" }, u)).id;
  obs = (await saveQuestion({ form: "consultoria", label: "Primeira lembrança do cabelo", kind: "texto_longo" }, u)).id;
});

describe("perguntas", () => {
  it("edita a pergunta da Casa que nasceu na migration (id md5, não é UUID v4)", async () => {
    const [m] = await db.execute(sql`insert into form_questions (id, form, position, label, kind) values (md5('fichas:anamnese:1')::uuid, 'anamnese', 9, 'Como conheceu a Casa Fiaes?', 'texto') returning id`).then((r) => r.rows as { id: string }[]);
    await saveQuestion({ id: m.id, form: "anamnese", label: "Como conheceu a Casa?", kind: "texto" }, u);
    expect((await listQuestions("anamnese")).find((q) => q.id === m.id)!.label).toBe("Como conheceu a Casa?");
  });
  it("nascem no fim da lista da ficha, na ordem; opções só para opção e caixas", async () => {
    expect((await listQuestions("anamnese")).map((q) => [q.label, q.position])).toEqual([["Como é sua rotina?", 0], ["Você já utilizou:", 1]]);
    expect((await listQuestions("campos"))[0]).toMatchObject({ label: "Apelido", kind: "texto", options: [] });
    const t = (await saveQuestion({ form: "campos", label: "Alergia a tinta", kind: "texto", options: ["a", "b"] }, u)).id;
    expect((await listQuestions("campos")).find((q) => q.id === t)!.options).toEqual([]);
  });
  it("opção e caixas pedem ao menos 2 opções; as repetidas e as vazias saem", async () => {
    await expect(saveQuestion({ form: "campos", label: "X", kind: "opcao", options: ["só uma"] }, u)).rejects.toThrow("Escreva ao menos duas opções.");
    await expect(saveQuestion({ form: "campos", label: "X", kind: "caixas" }, u)).rejects.toThrow("Escreva ao menos duas opções.");
    const id = (await saveQuestion({ form: "campos", label: "Y", kind: "opcao", options: [" Sim ", "", "Não", "sim", "Não"] }, u)).id;
    expect((await listQuestions("campos")).find((q) => q.id === id)!.options).toEqual(["Sim", "Não", "sim"]);
  });
  it("o texto da pergunta é obrigatório e a ficha tem que existir", async () => {
    await expect(saveQuestion({ form: "campos", label: "   ", kind: "texto" }, u)).rejects.toThrow("Escreva a pergunta.");
    await expect(saveQuestion({ form: "outra" as never, label: "X", kind: "texto" }, u)).rejects.toThrow();
    await expect(saveQuestion({ form: "campos", label: "X", kind: "foto" as never }, u)).rejects.toThrow();
  });
  it("editar muda texto, tipo e opções, mas não troca a pergunta de ficha; a resposta antiga fica", async () => {
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    await saveQuestion({ id: rotina, form: "anamnese", label: "Como é a sua rotina hoje?", kind: "opcao", options: ["Corrida", "Moderada", "Tranquila"] }, u);
    expect((await listQuestions("anamnese"))[0]).toMatchObject({ id: rotina, label: "Como é a sua rotina hoje?", options: ["Corrida", "Moderada", "Tranquila"], position: 0 });
    expect(await answers()).toHaveLength(1);
    await expect(saveQuestion({ id: rotina, form: "campos", label: "X", kind: "texto" }, u)).rejects.toThrow("Não dá para mudar a pergunta de ficha.");
    await expect(saveQuestion({ id: "00000000-0000-4000-8000-000000000000", form: "campos", label: "X", kind: "texto" }, u)).rejects.toThrow("Pergunta não encontrada.");
  });
  it("trocar o tipo é recusado se a pergunta já tem resposta; sem resposta pode; rótulo e opções sempre podem", async () => {
    expect((await listQuestions("anamnese")).map((q) => q.answered)).toEqual([false, false]);
    await saveQuestion({ id: rotina, form: "anamnese", label: "Rotina", kind: "caixas", options: ["Corrida", "Tranquila"] }, u); // sem resposta: troca
    expect((await listQuestions("anamnese"))[0]).toMatchObject({ kind: "caixas", label: "Rotina" });
    await saveAnswer({ contactId: c, questionId: rotina, value: ["Corrida"] }, u);
    expect((await listQuestions("anamnese"))[0].answered).toBe(true);
    await expect(saveQuestion({ id: rotina, form: "anamnese", label: "Rotina", kind: "texto" }, u)).rejects.toThrow("Essa pergunta já tem respostas. Crie uma nova e tire esta de uso.");
    expect((await listQuestions("anamnese"))[0].kind).toBe("caixas");
    await saveQuestion({ id: rotina, form: "anamnese", label: "Rotina nova", kind: "caixas", options: ["Corrida", "Tranquila", "Moderada"] }, u);
    expect((await listQuestions("anamnese"))[0]).toMatchObject({ label: "Rotina nova", options: ["Corrida", "Tranquila", "Moderada"] });
  });
  it("subir e descer troca de lugar com a vizinha, só dentro da ficha; no limite não faz nada", async () => {
    await moveQuestion(cor, "up", u);
    expect((await listQuestions("anamnese")).map((q) => q.id)).toEqual([cor, rotina]);
    await moveQuestion(cor, "up", u); // já é a primeira
    await moveQuestion(rotina, "down", u); // já é a última
    expect((await listQuestions("anamnese")).map((q) => q.id)).toEqual([cor, rotina]);
    expect((await listQuestions("campos")).map((q) => q.id)).toEqual([nome]);
  });
  it("desativar tira da lista; all traz também as desativadas; não existe apagar", async () => {
    await setQuestionActive(rotina, false, u);
    expect((await listQuestions("anamnese")).map((q) => q.id)).toEqual([cor]);
    expect((await listQuestions("anamnese", { all: true })).map((q) => q.id)).toEqual([rotina, cor]);
    await setQuestionActive(rotina, true, u);
    expect(await listQuestions("anamnese")).toHaveLength(2);
    await expect(setQuestionActive("00000000-0000-4000-8000-000000000000", false, u)).rejects.toThrow("Pergunta não encontrada.");
  });
  it("registra ficha_pergunta_editada na auditoria", async () => {
    await moveQuestion(cor, "up", u); await setQuestionActive(rotina, false, u);
    const a = await db.select().from(auditLog).where(eq(auditLog.action, "ficha_pergunta_editada"));
    expect(a.length).toBeGreaterThanOrEqual(6); // 4 criadas + mover + desativar
    expect(a.every((x) => x.entity === "form_question" && x.userId === u)).toBe(true);
  });
});

describe("respostas", () => {
  it("caixas aceita só opções da pergunta; vazio apaga a resposta", async () => {
    await expect(saveAnswer({ contactId: c, questionId: cor, value: ["Henna"] }, u)).rejects.toThrow("Escolha só opções da pergunta.");
    await saveAnswer({ contactId: c, questionId: cor, value: ["Coloração", "Outro"] }, u);
    expect((await answers())[0].value).toEqual(["Coloração", "Outro"]);
    await saveAnswer({ contactId: c, questionId: cor, value: [] }, u);
    expect(await answers()).toHaveLength(0);
    await saveAnswer({ contactId: c, questionId: nome, value: "Pa" }, u);
    await saveAnswer({ contactId: c, questionId: nome, value: "  " }, u);
    expect(await answers()).toHaveLength(0);
  });
  it("consultoria sem visita é recusada; anamnese e campos com visita são recusados", async () => {
    const v = await visita(c, "2026-10-10");
    await expect(saveAnswer({ contactId: c, questionId: obs, value: "x" }, u)).rejects.toThrow("A consultoria de imagem é de uma visita. Escolha a visita.");
    await expect(saveAnswer({ contactId: c, questionId: rotina, visitId: v, value: "Corrida" }, u)).rejects.toThrow("Essa ficha é da cliente, não de uma visita.");
    await expect(saveAnswer({ contactId: c, questionId: nome, visitId: v, value: "x" }, u)).rejects.toThrow("Essa ficha é da cliente, não de uma visita.");
    expect(await answers()).toHaveLength(0);
  });
  it("a visita tem que ser da cliente", async () => {
    const outra = await visita(c2, "2026-10-10");
    await expect(saveAnswer({ contactId: c, questionId: obs, visitId: outra, value: "x" }, u)).rejects.toThrow("Essa visita não é desta cliente.");
    await expect(saveAnswer({ contactId: c, questionId: obs, visitId: "00000000-0000-4000-8000-000000000000", value: "x" }, u)).rejects.toThrow("Visita não encontrada.");
  });
  it("cliente e pergunta têm que existir", async () => {
    await expect(saveAnswer({ contactId: "00000000-0000-4000-8000-000000000000", questionId: nome, value: "x" }, u)).rejects.toThrow("Cliente não encontrada.");
    await expect(saveAnswer({ contactId: c, questionId: "00000000-0000-4000-8000-000000000000", value: "x" }, u)).rejects.toThrow("Pergunta não encontrada.");
  });
  it("responder de novo troca a resposta (uma por cliente e pergunta; na consultoria, uma por visita)", async () => {
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    await saveAnswer({ contactId: c, questionId: rotina, value: "Tranquila" }, u);
    await saveAnswer({ contactId: c2, questionId: rotina, value: "Corrida" }, u);
    expect((await answers()).filter((a) => a.contactId === c).map((a) => a.value)).toEqual(["Tranquila"]);
    expect(await answers()).toHaveLength(2);
    const v1 = await visita(c, "2026-10-01"), v2 = await visita(c, "2026-10-08");
    await saveAnswer({ contactId: c, questionId: obs, visitId: v1, value: "a" }, u);
    await saveAnswer({ contactId: c, questionId: obs, visitId: v1, value: "b" }, u);
    await saveAnswer({ contactId: c, questionId: obs, visitId: v2, value: "c" }, u);
    expect((await answers()).filter((a) => a.questionId === obs).map((a) => a.value).sort()).toEqual(["b", "c"]);
  });
  it("guarda quem respondeu, a origem crm e a auditoria sem o valor", async () => {
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    expect((await answers())[0]).toMatchObject({ answeredBy: u, source: "crm", externalKey: null });
    const a = await db.select().from(auditLog).where(eq(auditLog.action, "ficha_respondida"));
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ userId: u, entityId: c });
    expect(JSON.stringify(a[0].data)).not.toContain("Corrida");
    expect(a[0].data).toMatchObject({ questionId: rotina });
  });
  it("o CRM sobrescrever uma resposta importada do Avec mantém a external_key e passa a source para crm", async () => {
    await db.insert(formAnswers).values({ contactId: c, questionId: rotina, value: "Corrida", source: "avec", externalKey: "avec:anamnese:1" });
    await saveAnswer({ contactId: c, questionId: rotina, value: "Tranquila" }, u);
    expect(await answers()).toMatchObject([{ value: "Tranquila", source: "crm", externalKey: "avec:anamnese:1", answeredBy: u }]);
  });
  it("limpar no CRM uma resposta que veio do Avec guarda a linha como limpa (source crm, valor vazio); sem external_key apaga de verdade", async () => {
    await db.insert(formAnswers).values({ contactId: c, questionId: rotina, value: "Corrida", source: "avec", externalKey: "avec:anamnese:1" });
    await saveAnswer({ contactId: c, questionId: rotina, value: "" }, u);
    expect(await answers()).toMatchObject([{ value: "", source: "crm", externalKey: "avec:anamnese:1", answeredBy: u }]);
    expect((await fichaOf(c)).anamnese.find((q) => q.questionId === rotina)!.value).toBeNull();
    expect((await fichaOf(c)).anamnese.filter((q) => q.value !== null)).toHaveLength(0);
    // responder de novo troca a linha limpa por uma resposta de verdade
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    expect((await fichaOf(c)).anamnese.find((q) => q.questionId === rotina)!.value).toBe("Corrida");
    await db.delete(formAnswers);
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    await saveAnswer({ contactId: c, questionId: rotina, value: null }, u);
    expect(await answers()).toHaveLength(0);
  });
  it("consultoria só com resposta limpa não aparece na ficha; pergunta desativada com resposta limpa também some", async () => {
    const v = await visita(c, "2026-10-01");
    await db.insert(formAnswers).values({ contactId: c, questionId: obs, visitId: v, value: "x", source: "avec", externalKey: "avec:ficha:k" });
    await saveAnswer({ contactId: c, questionId: obs, visitId: v, value: "" }, u);
    expect((await fichaOf(c)).consultorias).toEqual([]);
    await db.insert(formAnswers).values({ contactId: c, questionId: rotina, value: "Corrida", source: "avec", externalKey: "avec:ficha:k2" });
    await saveAnswer({ contactId: c, questionId: rotina, value: "" }, u);
    await setQuestionActive(rotina, false, u);
    expect((await fichaOf(c)).anamnese.map((q) => q.questionId)).not.toContain(rotina);
  });
  it("pergunta desativada some do preencher (recusa resposta nova), mas a resposta antiga aparece na ficha", async () => {
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    await setQuestionActive(rotina, false, u);
    await expect(saveAnswer({ contactId: c, questionId: rotina, value: "Tranquila" }, u)).rejects.toThrow("Essa pergunta não está mais em uso.");
    const f = await fichaOf(c);
    expect(f.anamnese.map((x) => x.questionId)).toEqual([rotina, cor]);
    expect(f.anamnese[0]).toMatchObject({ value: "Corrida" });
    expect((await fichaOf(c2)).anamnese.map((x) => x.questionId)).toEqual([cor]); // sem resposta, a desativada some
  });
});

describe("fichaOf", () => {
  it("anamnese e campos trazem todas as perguntas em uso, com a resposta ou null", async () => {
    await saveAnswer({ contactId: c, questionId: cor, value: ["Outro"] }, u);
    const f = await fichaOf(c);
    expect(f.anamnese).toMatchObject([
      { questionId: rotina, label: "Como é sua rotina?", kind: "opcao", options: ["Corrida", "Tranquila"], value: null, answeredAt: null },
      { questionId: cor, kind: "caixas", value: ["Outro"] },
    ]);
    expect(typeof f.anamnese[1].answeredAt).toBe("string");
    expect(f.campos).toMatchObject([{ questionId: nome, value: null }]);
    expect(f.consultorias).toEqual([]);
  });
  it("agrupa as consultorias por visita, a mais nova primeiro; visita sem resposta não aparece; uma cliente não vê a da outra", async () => {
    const q2 = (await saveQuestion({ form: "consultoria", label: "Como quer ser percebida", kind: "texto" }, u)).id;
    const v1 = await visita(c, "2026-09-20"), v2 = await visita(c, "2026-10-08"); await visita(c, "2026-10-15");
    const vo = await visita(c2, "2026-10-09");
    await saveAnswer({ contactId: c, questionId: obs, visitId: v1, value: "antiga" }, u);
    await saveAnswer({ contactId: c, questionId: obs, visitId: v2, value: "recente" }, u);
    await saveAnswer({ contactId: c, questionId: q2, visitId: v2, value: "elegante" }, u);
    await saveAnswer({ contactId: c2, questionId: obs, visitId: vo, value: "outra" }, u);
    const f = await fichaOf(c);
    expect(f.consultorias.map((x) => [x.visitId, x.day])).toEqual([[v2, "2026-10-08"], [v1, "2026-09-20"]]);
    expect(f.consultorias[0].items.map((i) => [i.label, i.value])).toEqual([["Primeira lembrança do cabelo", "recente"], ["Como quer ser percebida", "elegante"]]);
    expect(f.consultorias[1].items.map((i) => i.value)).toEqual(["antiga", null]);
  });
});

describe("função e uso do histórico", () => {
  it("com a função fichas desligada, criar pergunta e responder são recusados no servidor; ler continua", async () => {
    await saveAnswer({ contactId: c, questionId: rotina, value: "Corrida" }, u);
    await saveFuncoes({ fichas: false }, u);
    const off = "Essa função está desligada em Configurações › Recursos.";
    await expect(saveQuestion({ form: "campos", label: "Novo", kind: "texto" }, u)).rejects.toThrow(off);
    await expect(saveAnswer({ contactId: c, questionId: rotina, value: "Tranquila" }, u)).rejects.toThrow(off);
    await expect(moveQuestion(cor, "up", u)).rejects.toThrow(off);
    await expect(setQuestionActive(cor, false, u)).rejects.toThrow(off);
    expect((await fichaOf(c)).anamnese[0].value).toBe("Corrida");
    expect(await listQuestions("anamnese")).toHaveLength(2);
    expect(await db.select().from(formQuestions)).toHaveLength(4);
  });
});
