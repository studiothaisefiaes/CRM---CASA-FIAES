import { beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import { avecRejectedRows, contacts, formAnswers, formQuestions, users, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { importa } from "../../../../test/avec-fixtures";
import { saveFuncoes } from "../funcoes";
import { fichaOf, saveAnswer } from "../fichas";
import { detectFormat } from "./formats";

const NOW = new Date("2026-10-17T12:00:00Z");
const H0115 = ["Cliente", "Campo", "Slug", "Valor", "Data Cadastro"];
const H0116 = ["Cliente", "Data", "Comanda", "Campo", "Slug", "Valor", "Data Cadastro"];
const COMO_CONHECEU = "Como conheceu a Casa Fiaes?";

const cliente = async (name: string, phone: string) => (await db.insert(contacts).values({ name, phoneE164: phone }).returning())[0];
const answers = () => db.select().from(formAnswers);
const questionOf = async (label: string) => (await db.select().from(formQuestions).where(eq(formQuestions.label, label)))[0];

beforeEach(async () => {
  await resetDb();
  await db.insert(formQuestions).values([
    { form: "anamnese", position: 0, label: COMO_CONHECEU, kind: "opcao", options: ["Indicação", "Instagram", "Evento", "Outro"] },
    { form: "anamnese", position: 1, label: "Como é sua rotina hoje?", kind: "opcao", options: ["Muito corrida", "Tranquila"] },
  ]);
});

describe("fichas do Avec (0115, 2115 e 0116)", () => {
  it("0115 e 0116 têm o papel fichas; lista de clientes comum não", () => {
    expect(detectFormat(H0115).roles).toContain("fichas");
    expect(detectFormat(H0116).roles).toContain("fichas");
    expect(detectFormat(["Cliente", "Campo", "Slug", "Valor"]).roles).toContain("fichas");
    expect(detectFormat(["Campo", "Slug", "Valor"]).roles).not.toContain("fichas");
    expect(detectFormat(["Nome", "Celular", "E-mail"]).roles).not.toContain("fichas");
  });

  it("0115: resposta casa com a pergunta pelo rótulo normalizado e grava source 'avec'", async () => {
    const ana = await cliente("Ana Teste", "+5571900000001");
    const r = await importa("a.xlsx", H0115, [["Ana Teste", "como CONHECEU a casa fiaes", "como-conheceu", "Instagram", "05/10/2026"]], { now: NOW });
    expect(r.summary.fichas).toBe(1);
    const [a] = await answers();
    const q = await questionOf(COMO_CONHECEU);
    expect(a).toMatchObject({ contactId: ana.id, questionId: q.id, visitId: null, value: "Instagram", source: "avec", externalKey: `avec:ficha:${ana.id}:${q.id}:-` });
  });

  it("0115: pergunta que não existe na anamnese é ignorada (só a consultoria cria)", async () => {
    await cliente("Ana Teste", "+5571900000001");
    const antes = (await db.select().from(formQuestions)).length;
    await importa("a.xlsx", H0115, [["Ana Teste", "Pergunta inventada", "inventada", "x", ""]], { now: NOW });
    expect(await answers()).toHaveLength(0);
    expect(await db.select().from(formQuestions)).toHaveLength(antes);
  });

  it("0116: pergunta que não existe é criada na consultoria (rótulo exato do Campo, avec_slug = Slug), na ordem em que aparece", async () => {
    const bia = await cliente("Bia Teste", "+5571900000002");
    await importa("p.xlsx", H0116, [
      ["Bia Teste", "10/10/2026", "123", "Tipo de cabelo", "tipo-cabelo", "Cacheado", "10/10/2026"],
      ["Bia Teste", "10/10/2026", "123", "Queixa Principal", "queixa", "Frizz", "10/10/2026"],
    ], { now: NOW });
    const qs = await db.select().from(formQuestions).where(eq(formQuestions.form, "consultoria")).orderBy(asc(formQuestions.position));
    expect(qs.map((q) => [q.label, q.avecSlug, q.active])).toEqual([["Tipo de cabelo", "tipo-cabelo", true], ["Queixa Principal", "queixa", true]]);
    expect(qs[1].position).toBe(qs[0].position + 1);
    const [v] = await db.select().from(visits).where(eq(visits.contactId, bia.id));
    expect(v.day).toBe("2026-10-10");
    const rs = await answers();
    expect(rs.map((a) => [a.visitId, a.value, a.source])).toEqual([[v.id, "Cacheado", "avec"], [v.id, "Frizz", "avec"]]);
    // reimportar não duplica nem recria pergunta
    await importa("p2.xlsx", H0116, [["Bia Teste", "10/10/2026", "123", "Tipo de cabelo", "tipo-cabelo", "Cacheado", "11/10/2026"]], { now: NOW });
    expect(await db.select().from(formQuestions).where(eq(formQuestions.form, "consultoria"))).toHaveLength(2);
    expect(await answers()).toHaveLength(2);
  });

  it("valor vazio não grava; cliente com nome ambíguo ou desconhecido vai para avec_rejected_rows 'cliente_nao_encontrada'", async () => {
    await cliente("Ana Teste", "+5571900000001");
    await cliente("Maria Igual", "+5571900000003");
    await cliente("Maria Igual", "+5571900000004");
    const r = await importa("a.xlsx", H0115, [
      ["Ana Teste", COMO_CONHECEU, "x", "   ", "05/10/2026"],
      ["Maria Igual", COMO_CONHECEU, "x", "Evento", "05/10/2026"],
      ["Fulana Que Nao Existe", COMO_CONHECEU, "x", "Evento", "05/10/2026"],
    ], { now: NOW });
    expect(await answers()).toHaveLength(0);
    expect(r.summary.fichas).toBe(0);
    const rej = await db.select().from(avecRejectedRows);
    expect(rej.map((x) => [x.reason, x.clientName]).sort()).toEqual([["cliente_nao_encontrada", "Fulana Que Nao Existe"], ["cliente_nao_encontrada", "Maria Igual"]]);
    // reimportar: uma rejeitada por chave
    await importa("a2.xlsx", H0115, [["Maria Igual", COMO_CONHECEU, "x", "Evento", "06/10/2026"]], { now: NOW });
    expect(await db.select().from(avecRejectedRows)).toHaveLength(2);
  });

  it("importar de novo não duplica, atualiza o que veio do Avec e NÃO sobrescreve resposta dada no CRM", async () => {
    const ana = await cliente("Ana Teste", "+5571900000001");
    const [u] = await db.insert(users).values({ email: "t@teste.com", name: "T", passwordHash: "x" }).returning();
    const q = await questionOf(COMO_CONHECEU);
    const q2 = await questionOf("Como é sua rotina hoje?");
    await importa("a.xlsx", H0115, [["Ana Teste", COMO_CONHECEU, "x", "Instagram", "05/10/2026"]], { now: NOW });
    await importa("a.xlsx", H0115, [["Ana Teste", COMO_CONHECEU, "x", "Instagram", "05/10/2026"]], { now: NOW });
    expect(await answers()).toHaveLength(1);
    // o Avec muda o valor de uma resposta do próprio Avec: atualiza
    const r = await importa("b.xlsx", H0115, [["Ana Teste", COMO_CONHECEU, "x", "Evento", "05/10/2026"]], { now: NOW });
    expect(r.summary.fichas).toBe(1);
    expect((await answers())[0].value).toBe("Evento");
    // CRM sobrescreve a resposta importada (mantém a external_key): reimportar não mexe
    await saveAnswer({ contactId: ana.id, questionId: q.id, value: "Indicação" }, u.id);
    const r2 = await importa("c.xlsx", H0115, [["Ana Teste", COMO_CONHECEU, "x", "Outro", "05/10/2026"]], { now: NOW });
    const [a] = await db.select().from(formAnswers).where(and(eq(formAnswers.contactId, ana.id), eq(formAnswers.questionId, q.id)));
    expect(a).toMatchObject({ value: "Indicação", source: "crm" });
    expect(r2.summary.fichas).toBe(0);
    // resposta do CRM SEM external_key (cliente/pergunta/visita já ocupados): nem erro, nem sobrescreve, nem duplica
    await saveAnswer({ contactId: ana.id, questionId: q2.id, value: "Tranquila" }, u.id);
    await importa("d.xlsx", H0115, [["Ana Teste", "Como é sua rotina hoje?", "x", "Muito corrida", "05/10/2026"]], { now: NOW });
    const [b] = await db.select().from(formAnswers).where(and(eq(formAnswers.contactId, ana.id), eq(formAnswers.questionId, q2.id)));
    expect(b).toMatchObject({ value: "Tranquila", source: "crm", externalKey: null });
    expect(await answers()).toHaveLength(2);
  });

  it("resposta do Avec limpa no CRM não volta na reimportação", async () => {
    const ana = await cliente("Ana Teste", "+5571900000001");
    const [u] = await db.insert(users).values({ email: "t@teste.com", name: "T", passwordHash: "x" }).returning();
    const q = await questionOf(COMO_CONHECEU);
    await importa("a.xlsx", H0115, [["Ana Teste", COMO_CONHECEU, "x", "Instagram", "05/10/2026"]], { now: NOW });
    await saveAnswer({ contactId: ana.id, questionId: q.id, value: null }, u.id);
    const r = await importa("b.xlsx", H0115, [["Ana Teste", COMO_CONHECEU, "x", "Instagram", "06/10/2026"]], { now: NOW });
    expect(r.summary.fichas).toBe(0);
    expect(await answers()).toMatchObject([{ value: "", source: "crm" }]);
    expect((await fichaOf(ana.id)).anamnese.find((x) => x.questionId === q.id)!.value).toBeNull();
  });

  it("consultoria: resposta dada no CRM na mesma visita é preservada", async () => {
    const bia = await cliente("Bia Teste", "+5571900000002");
    const [u] = await db.insert(users).values({ email: "t@teste.com", name: "T", passwordHash: "x" }).returning();
    await importa("p.xlsx", H0116, [["Bia Teste", "10/10/2026", "123", "Tipo de cabelo", "tipo", "Cacheado", "10/10/2026"]], { now: NOW });
    const [a] = await answers();
    await saveAnswer({ contactId: bia.id, questionId: a.questionId, visitId: a.visitId, value: "Liso" }, u.id);
    const r = await importa("p2.xlsx", H0116, [["Bia Teste", "10/10/2026", "123", "Tipo de cabelo", "tipo", "Ondulado", "11/10/2026"]], { now: NOW });
    expect(r.summary.fichas).toBe(0);
    expect(await answers()).toMatchObject([{ value: "Liso", source: "crm" }]);
  });

  it("conta as linhas ignoradas: consultoria sem data e pergunta de anamnese que a Casa não tem", async () => {
    await cliente("Ana Teste", "+5571900000001");
    const r1 = await importa("a.xlsx", H0115, [["Ana Teste", "Pergunta inventada", "z", "x", ""]], { now: NOW });
    expect(r1.summary).toMatchObject({ fichas: 0, fichasIgnoradas: 1 });
    const r2 = await importa("p.xlsx", H0116, [["Ana Teste", "", "1", "Tipo", "tipo", "Liso", ""]], { now: NOW });
    expect(r2.summary).toMatchObject({ fichas: 0, fichasIgnoradas: 1 });
  });

  it("função fichas desligada: nada gravado e as linhas não viram rejeitadas", async () => {
    await cliente("Ana Teste", "+5571900000001");
    const [u] = await db.insert(users).values({ email: "t@teste.com", name: "T", passwordHash: "x" }).returning();
    await saveFuncoes({ fichas: false }, u.id);
    const r = await importa("a.xlsx", H0115, [
      ["Ana Teste", COMO_CONHECEU, "x", "Instagram", "05/10/2026"],
      ["Desconhecida", COMO_CONHECEU, "x", "Instagram", "05/10/2026"],
    ], { now: NOW });
    expect(await answers()).toHaveLength(0);
    expect(await db.select().from(avecRejectedRows)).toHaveLength(0);
    expect(r.summary).toMatchObject({ fichas: 0, fichasDesligada: 1 });
    const antes = await importa("p.xlsx", H0116, [["Ana Teste", "10/10/2026", "1", "Campo novo", "novo", "v", ""]], { now: NOW });
    expect(antes.summary.fichas).toBe(0);
    expect(await db.select().from(formQuestions).where(eq(formQuestions.avecSlug, "novo"))).toHaveLength(0);
  });
});
