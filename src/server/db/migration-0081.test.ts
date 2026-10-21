import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { contacts, formAnswers, formQuestions } from "./schema";
import { resetDb } from "../../../test/db";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0081_fichas.sql"), "utf8");
const run = () => db.execute(sql.raw(SQL.replaceAll("--> statement-breakpoint", "")));
const anamnese = () => db.select().from(formQuestions).where(eq(formQuestions.form, "anamnese")).orderBy(formQuestions.position);

describe("0082: fichas da cliente", () => {
  beforeEach(resetDb);

  it("traz as 32 perguntas da anamnese da Casa, na ordem, com tipo e opções; a consultoria nasce vazia; roda 2 vezes", async () => {
    await run(); await run();
    const q = await anamnese();
    expect(q).toHaveLength(32);
    expect(q[0]).toMatchObject({ label: "Como conheceu a Casa Fiaes?", kind: "opcao", options: ["Indicação", "Instagram", "Evento", "Cliente antiga", "Outro"], active: true });
    expect(q[31]).toMatchObject({ kind: "sim_nao" });
    expect(q[31].label).toMatch(/^Declaração de que as informações são verdadeiras/);
    expect(await db.select().from(formQuestions).where(eq(formQuestions.form, "consultoria"))).toHaveLength(0);
    expect(await db.select().from(formQuestions).where(eq(formQuestions.form, "campos"))).toHaveLength(0);
  });

  it("os tipos seguem o §3.2: caixas nas nº 6, 14 e 20; texto longo da 15 à 18; as nº 9 a 13 têm o nome do campo como rótulo", async () => {
    await run();
    const q = await anamnese();
    const kinds = q.map((x) => x.kind);
    expect([5, 13, 19].map((i) => kinds[i])).toEqual(["caixas", "caixas", "caixas"]);
    expect(kinds.slice(14, 18)).toEqual(["texto_longo", "texto_longo", "texto_longo", "texto_longo"]);
    expect(q.slice(8, 13).map((x) => x.label)).toEqual(["Estrutura do fio", "Textura natural", "Porosidade", "Densidade", "Elasticidade"]);
    expect(q[8].options).toEqual(["Fino", "Médio", "Grosso"]);
    expect(q.filter((x) => ["opcao", "caixas"].includes(x.kind)).every((x) => x.options.length >= 2)).toBe(true);
    expect(q.filter((x) => !["opcao", "caixas"].includes(x.kind)).every((x) => x.options.length === 0)).toBe(true);
  });

  it("rodar de novo não troca o que a Casa editou", async () => {
    await run();
    const [p] = await anamnese();
    await db.update(formQuestions).set({ label: "Como chegou até nós?", active: false }).where(eq(formQuestions.id, p.id));
    await run();
    expect((await anamnese())[0]).toMatchObject({ label: "Como chegou até nós?", active: false });
    expect(await anamnese()).toHaveLength(32);
  });

  it("uma resposta por cliente, pergunta e visita (também sem visita)", async () => {
    await run();
    const [c] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571966000301" }).returning();
    const [p] = await anamnese();
    await db.insert(formAnswers).values({ contactId: c.id, questionId: p.id, value: "Instagram" });
    await expect(db.insert(formAnswers).values({ contactId: c.id, questionId: p.id, value: "Evento" })).rejects.toThrow();
  });
});
