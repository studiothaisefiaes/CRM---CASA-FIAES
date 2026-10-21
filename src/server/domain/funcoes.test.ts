import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import type { FuncaoDef } from "@/lib/funcoes";
import { assertFuncaoLigada, funcaoLigada, funcaoParam, funcaoTexto, getFuncoesState, saveFuncao } from "./funcoes";

const DEFS: FuncaoDef[] = [
  { key: "envia", label: "Aviso de teste", description: "x", enviaParaCliente: true, padraoLigada: false,
    params: [{ key: "horas", label: "Horas", min: 1, max: 48, default: 24 }],
    textos: [{ key: "aviso", label: "Aviso", vars: ["nome"], default: "Oi, {nome}!" }] },
  { key: "interna", label: "Função interna", description: "x", enviaParaCliente: false, padraoLigada: true },
  { key: "propria", label: "Menu", description: "x", enviaParaCliente: false, padraoLigada: false, ligaEm: "/config/menu", params: [{ key: "n", label: "N", min: 1, max: 5, default: 2 }] },
];
let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Thaíse", email: "g@teste.local", role: "gestor", passwordHash: "x" }).returning();
});

describe("funcoes (servidor)", () => {
  it("sem nada salvo vale o padrão", async () => {
    expect(await getFuncoesState()).toEqual({});
    expect(await funcaoLigada("envia", DEFS)).toBe(false);
    expect(await funcaoLigada("interna", DEFS)).toBe(true);
    expect(await funcaoParam("envia", "horas", DEFS)).toBe(24);
    expect(await funcaoTexto("envia", "aviso", DEFS)).toBe("Oi, {nome}!");
  });
  it("salvar muda o que as leituras devolvem, e null volta ao sugerido", async () => {
    await saveFuncao("envia", { on: true, params: { horas: 6 }, textos: { aviso: "Olá {nome}" } }, uid, { confirmouEnvio: true }, DEFS);
    expect(await funcaoLigada("envia", DEFS)).toBe(true);
    expect(await funcaoParam("envia", "horas", DEFS)).toBe(6);
    expect(await funcaoTexto("envia", "aviso", DEFS)).toBe("Olá {nome}");
    await saveFuncao("envia", { textos: { aviso: null } }, uid, undefined, DEFS);
    expect(await funcaoTexto("envia", "aviso", DEFS)).toBe("Oi, {nome}!");
    expect(await funcaoParam("envia", "horas", DEFS)).toBe(6); // merge
    expect(await funcaoLigada("envia", DEFS)).toBe(true);
  });
  it("audita com de/para", async () => {
    await saveFuncao("interna", { on: false }, uid, undefined, DEFS);
    const [a] = await db.select().from(auditLog).where(eq(auditLog.action, "funcao"));
    expect(a.userId).toBe(uid);
    expect(a.data).toEqual({ key: "interna", de: { on: true }, para: { on: false } });
  });
  it("ligar função que envia sem confirmar é recusado; desligar não precisa", async () => {
    await expect(saveFuncao("envia", { on: true }, uid, undefined, DEFS)).rejects.toThrow("Confirme o envio real para ligar.");
    await expect(saveFuncao("envia", { on: true }, uid, { confirmouEnvio: false }, DEFS)).rejects.toThrow("Confirme o envio real para ligar.");
    expect(await funcaoLigada("envia", DEFS)).toBe(false);
    await saveFuncao("envia", { on: false }, uid, undefined, DEFS);
  });
  it("mudar `on` de função com tela própria é recusado, mas os números vão", async () => {
    await expect(saveFuncao("propria", { on: true }, uid, undefined, DEFS)).rejects.toThrow("Ligue em /config/menu.");
    await saveFuncao("propria", { params: { n: 4 } }, uid, undefined, DEFS);
    expect(await funcaoParam("propria", "n", DEFS)).toBe(4);
  });
  it("recusa chave desconhecida e valor inválido, sem gravar nada", async () => {
    await expect(saveFuncao("nao-existe", { on: true }, uid, undefined, DEFS)).rejects.toThrow();
    await expect(saveFuncao("envia", { params: { horas: 100 } }, uid, undefined, DEFS)).rejects.toThrow("Horas: use um número de 1 a 48.");
    await expect(funcaoLigada("nao-existe", DEFS)).rejects.toThrow();
    expect(await getFuncoesState()).toEqual({});
  });
  it("assertFuncaoLigada recusa com o nome da função", async () => {
    await expect(assertFuncaoLigada("envia", DEFS)).rejects.toThrow("Aviso de teste está desligada em Configurações › Recursos.");
    await expect(assertFuncaoLigada("interna", DEFS)).resolves.toBeUndefined();
  });
  it("duas gravações ao mesmo tempo em funções diferentes ficam as duas, e o `de` da auditoria é o real", async () => {
    await Promise.all([
      saveFuncao("interna", { on: false }, uid, undefined, DEFS),
      saveFuncao("envia", { params: { horas: 7 } }, uid, undefined, DEFS),
      saveFuncao("propria", { params: { n: 5 } }, uid, undefined, DEFS),
    ]);
    expect(await funcaoLigada("interna", DEFS)).toBe(false);
    expect(await funcaoParam("envia", "horas", DEFS)).toBe(7);
    expect(await funcaoParam("propria", "n", DEFS)).toBe(5);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "funcao"))).toHaveLength(3);
  });
});
