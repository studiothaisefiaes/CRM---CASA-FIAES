import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { FUNCOES_FASE_C as FUNCOES, FUNCAO_HELP, FUNCAO_LABEL } from "@/lib/funcoes";
import { assertFuncao, getFuncoes, getFuncoesState, isFuncaoOn, saveFuncoes } from "./funcoes";

let g = "";
beforeEach(async () => { await resetDb(); g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id; });

describe("lista de funções (puro)", () => {
  it("são 12, com nome, ajuda e padrão ligado (o padrão é testado em getFuncoes)", () => {
    expect(FUNCOES).toHaveLength(12);
    for (const f of FUNCOES) { expect(FUNCAO_LABEL[f], f).toBeTruthy(); expect(FUNCAO_HELP[f].length, f).toBeGreaterThan(15); }
    expect(FUNCAO_LABEL.passar_dia).toBe("Passar o dia");
    expect(FUNCAO_LABEL.junto_com_outro).toBe("Serviço junto com outro");
  });
});

describe("liga/desliga por função", () => {
  it("sem nada nas configurações, todas ligadas e assertFuncao passa", async () => {
    const f = await getFuncoes();
    for (const k of FUNCOES) expect(f[k], k).toBe(true);
    expect(await isFuncaoOn("fotos")).toBe(true);
    await expect(assertFuncao("fotos")).resolves.toBeUndefined();
  });
  it("saveFuncoes desliga uma, assertFuncao recusa com a mensagem exata e as outras seguem ligadas", async () => {
    await saveFuncoes({ passar_dia: false }, g);
    expect(await isFuncaoOn("passar_dia")).toBe(false);
    expect(await isFuncaoOn("unir")).toBe(true);
    await expect(assertFuncao("passar_dia")).rejects.toThrow("Essa função está desligada em Configurações › Recursos.");
    await saveFuncoes({ passar_dia: true }, g);
    await expect(assertFuncao("passar_dia")).resolves.toBeUndefined();
  });
  it("saveFuncoes junta com o que já estava salvo", async () => {
    await saveFuncoes({ unir: false }, g);
    await saveFuncoes({ fotos: false }, g);
    const f = await getFuncoes();
    expect(f.unir).toBe(false); expect(f.fotos).toBe(false); expect(f.fidelidade).toBe(true);
  });
  it("valor inválido ou chave desconhecida no banco cai no padrão", async () => {
    await db.insert(settings).values({ key: "funcoes", value: { fotos: "não", unir: 0, repetir: false, inventada: false } });
    const f = await getFuncoes();
    expect(f.fotos).toBe(true); expect(f.unir).toBe(true); expect(f.repetir).toBe(false);
    expect(Object.keys(f).sort()).toEqual([...FUNCOES].sort());
    await db.update(settings).set({ value: "lixo" }).where(eq(settings.key, "funcoes"));
    expect((await getFuncoes()).repetir).toBe(true);
  });
  it("grava na auditoria (settings/funcoes) quem mudou", async () => {
    await saveFuncoes({ uso_imagem: false }, g);
    const rows = await db.select().from(auditLog).where(and(eq(auditLog.entity, "settings"), eq(auditLog.entityId, "funcoes")));
    expect(rows).toHaveLength(1);
    expect(rows[0].userId).toBe(g);
    expect(rows[0].data).toMatchObject({ key: "uso_imagem", de: { on: true }, para: { on: false } });
  });
});

describe("QA r66 M-2: chave malformada em settings.funcoes", () => {
  it("a chave de 316 caracteres com {on: true} é ignorada na leitura e some na próxima gravação; as funções seguem", async () => {
    const lixo = "setores consentimento pausa_automaticas biblioteca " .repeat(6).trim() + " unir";
    await db.insert(settings).values({ key: "funcoes", value: { [lixo]: { on: true }, passar_dia: { on: false } } }).onConflictDoUpdate({ target: settings.key, set: { value: { [lixo]: { on: true }, passar_dia: { on: false } } } });
    const state = await getFuncoesState();
    expect(Object.keys(state)).toEqual(["passar_dia"]);
    expect(await isFuncaoOn("passar_dia")).toBe(false);
    expect(await isFuncaoOn("unir")).toBe(true);
    await saveFuncoes({ fotos: false }, g);
    const [row] = await db.select().from(settings).where(eq(settings.key, "funcoes"));
    expect(Object.keys(row.value as object).sort()).toEqual(["fotos", "passar_dia"]);
  });
});
