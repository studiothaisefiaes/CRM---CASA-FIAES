import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, lists, loyaltyPrograms, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { saveFuncoes } from "./funcoes";
import { getAvecLoyaltyProgramId, listLoyaltyPrograms, saveAvecLoyaltyProgram, saveLoyaltyProgram, type LoyaltyProgramInput } from "./fidelidade-programas";
import { rewardReasonOf } from "./fidelidade";

let uid: string, fiel: string, aniv: string, corte: string, fin: string;
const base = (over: Partial<LoyaltyProgramInput> = {}): LoyaltyProgramInput => ({
  id: fiel, name: "Fiel da Fiaes", description: null, goal: 12, countsServiceIds: null, rewardServiceIds: [fin], rewardDiscountBp: 10000, maxDiscountBp: 2000,
  countsPackageSessions: false, rewardReasonTemplate: "", active: true, ...over,
});

beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ email: "g@teste.com", name: "G", passwordHash: "x" }).returning();
  [{ id: corte }, { id: fin }] = await db.insert(lists).values([
    { kind: "service", label: "Corte teste", position: 90 }, { kind: "service", label: "Finalização teste", position: 91 },
  ]).returning();
  [fiel, aniv] = (await db.insert(loyaltyPrograms).values([
    { name: "Fiel da Fiaes", kind: "contagem", goal: 12, position: 0 }, { name: "Aniversário", kind: "aniversario", position: 1 },
  ]).returning()).map((p) => p.id);
});

describe("editar os programas de fidelidade", () => {
  it("muda nome, meta, quais serviços contam e quais são prêmio, os descontos, pacote e motivo (vazio = o texto sugerido)", async () => {
    await saveLoyaltyProgram(base({ name: "Fiel 2", description: " Para quem volta ", goal: 8, countsServiceIds: [corte], rewardServiceIds: [fin, corte], rewardDiscountBp: 5000, maxDiscountBp: 1000, countsPackageSessions: true, rewardReasonTemplate: "Prêmio: {programa}" }), uid);
    const [p] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.id, fiel));
    expect(p).toMatchObject({ name: "Fiel 2", description: "Para quem volta", goal: 8, countsServiceIds: [corte], rewardServiceIds: [fin, corte], rewardDiscountBp: 5000, maxDiscountBp: 1000, countsPackageSessions: true });
    expect(rewardReasonOf(p)).toBe("Prêmio: Fiel 2");
    await saveLoyaltyProgram(base({ name: "Fiel 2", rewardReasonTemplate: "  " }), uid);
    const [q] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.id, fiel));
    expect(q.rewardReasonTemplate).toBe("Fidelidade: {programa}");
    expect(q.countsServiceIds).toBeNull(); // todos os serviços contam
    expect((await db.select().from(auditLog).where(eq(auditLog.entity, "loyalty_program"))).length).toBe(2);
  });

  it("aniversário não tem meta nem serviços que contam; o tipo não muda", async () => {
    await saveLoyaltyProgram(base({ id: aniv, name: "Aniversário", goal: 5, countsServiceIds: [corte], rewardServiceIds: [fin], rewardDiscountBp: 5000, maxDiscountBp: null }), uid);
    const [p] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.id, aniv));
    expect(p).toMatchObject({ kind: "aniversario", goal: null, countsServiceIds: null, rewardDiscountBp: 5000 });
  });

  it("cria um programa de contagem no fim da lista", async () => {
    const { id } = await saveLoyaltyProgram(base({ id: null, name: "Novo" }), uid);
    const all = await listLoyaltyPrograms();
    expect(all.at(-1)).toMatchObject({ id, name: "Novo", kind: "contagem", position: 2 });
  });

  it("recusas com mensagem: nome repetido, sem meta, serviço que não existe, desconto fora da faixa, programa que não existe", async () => {
    await expect(saveLoyaltyProgram(base({ name: "Aniversário" }), uid)).rejects.toThrow("Já existe um programa com esse nome.");
    await expect(saveLoyaltyProgram(base({ goal: null }), uid)).rejects.toThrow("Meta");
    await expect(saveLoyaltyProgram(base({ rewardServiceIds: ["11111111-1111-4111-8111-111111111111"] }), uid)).rejects.toThrow("Algum serviço escolhido não existe mais");
    await expect(saveLoyaltyProgram(base({ rewardDiscountBp: 10001 }), uid)).rejects.toThrow();
    await expect(saveLoyaltyProgram(base({ rewardDiscountBp: 0 }), uid)).rejects.toThrow();
    await expect(saveLoyaltyProgram(base({ id: "11111111-1111-4111-8111-111111111111" }), uid)).rejects.toThrow("Programa de fidelidade não encontrado.");
  });

  it("só aceita serviços de verdade (id de outra lista é recusado)", async () => {
    const [tag] = await db.insert(lists).values({ kind: "origin", label: "Qualquer" }).returning();
    await expect(saveLoyaltyProgram(base({ rewardServiceIds: [tag.id] }), uid)).rejects.toThrow("Algum serviço escolhido não existe mais");
    await expect(saveLoyaltyProgram(base({ countsServiceIds: [tag.id] }), uid)).rejects.toThrow("Algum serviço escolhido não existe mais");
  });

  it("função Fidelidade desligada recusa", async () => {
    await saveFuncoes({ fidelidade: false }, uid);
    await expect(saveLoyaltyProgram(base(), uid)).rejects.toThrow("Essa função está desligada");
    await expect(saveAvecLoyaltyProgram(fiel, uid)).rejects.toThrow("Essa função está desligada");
  });
});

describe("programa que recebe o saldo do Avec", () => {
  it("o padrão é o Fiel da Fiaes; escolher outro vale; null volta ao padrão; aniversário não serve", async () => {
    const [dez] = await db.insert(loyaltyPrograms).values({ name: "10x Você", kind: "contagem", goal: 10, position: 3 }).returning();
    expect(await getAvecLoyaltyProgramId()).toBe(fiel);
    await saveAvecLoyaltyProgram(dez.id, uid);
    expect(await getAvecLoyaltyProgramId()).toBe(dez.id);
    await expect(saveAvecLoyaltyProgram(aniv, uid)).rejects.toThrow("só entra em programa de contagem");
    await saveAvecLoyaltyProgram(null, uid);
    expect(await getAvecLoyaltyProgramId()).toBe(fiel);
  });

  it("depois de renomear o Fiel da Fiaes, sem escolha vale o primeiro programa de contagem em uso", async () => {
    await saveLoyaltyProgram(base({ name: "Fiel 2026" }), uid);
    expect(await getAvecLoyaltyProgramId()).toBe(fiel);
    await db.update(loyaltyPrograms).set({ active: false }).where(eq(loyaltyPrograms.id, fiel));
    const [dez] = await db.insert(loyaltyPrograms).values({ name: "10x Você", kind: "contagem", goal: 10, position: 3 }).returning();
    expect(await getAvecLoyaltyProgramId()).toBe(dez.id);
  });
});
