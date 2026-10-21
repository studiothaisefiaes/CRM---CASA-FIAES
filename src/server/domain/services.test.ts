import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { auditLog, lists, professionalServices, professionals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { createService, listServicesPage, updateService } from "./services";
import { loadCasaData } from "../ai/suggest";

let g = "", ana = "", bia = "";
beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [ana, bia] = (await db.insert(professionals).values([{ name: "Ana" }, { name: "Bia", color: "rosa" }]).returning()).map((p) => p.id);
});
const row = async (id: string) => (await db.select().from(lists).where(eq(lists.id, id)))[0];
const prosOf = async (id: string) => (await db.select({ p: professionalServices.professionalId }).from(professionalServices).where(eq(professionalServices.serviceId, id))).map((r) => r.p).sort();

describe("Serviços: 'A IA oferece só com' (17/10)", () => {
  it("grava as profissionais e quando vale; vazio tira a regra inteira; profissional que não existe é recusada; a lista devolve a regra", async () => {
    const { id } = await createService({ label: "AVALIAÇÃO", professionalIds: [ana, bia], aiProIds: [ana], aiProScope: "metodo" }, g);
    expect(await row(id)).toMatchObject({ aiProIds: [ana], aiProScope: "metodo" });
    expect(await prosOf(id)).toEqual([ana, bia].sort()); // quem faz não muda
    expect((await listServicesPage()).services.find((s) => s.id === id)).toMatchObject({ aiProIds: [ana], aiProScope: "metodo" });
    await updateService(id, { aiProIds: [bia] }, g); // sem dizer quando: mantém
    expect(await row(id)).toMatchObject({ aiProIds: [bia], aiProScope: "metodo" });
    await updateService(id, { aiProIds: [], aiProScope: "sempre" }, g);
    expect(await row(id)).toMatchObject({ aiProIds: null, aiProScope: null });
    await updateService(id, { aiProIds: [ana] }, g); // sem quando: sempre
    expect(await row(id)).toMatchObject({ aiProIds: [ana], aiProScope: "sempre" });
    await expect(updateService(id, { aiProIds: ["00000000-0000-4000-8000-000000000000"] }, g)).rejects.toThrow(/Profissional/);
  });
});

describe("Serviços: criar", () => {
  it("cria com nome, categoria, preço, duração, descrição e quem faz; registra no histórico", async () => {
    const { id } = await createService({ label: "  Escova  modelada ", category: "Finalização", priceCents: 12_000, durationMin: 45, description: " Escova lisa ou ondulada. ", professionalIds: [ana] }, g);
    expect(await row(id)).toMatchObject({ kind: "service", label: "Escova modelada", category: "Finalização", priceCents: 12_000, durationMin: 45, description: "Escova lisa ou ondulada.", active: true });
    expect(await prosOf(id)).toEqual([ana]);
    expect((await db.select().from(auditLog).where(and(eq(auditLog.entityId, id), eq(auditLog.action, "adicionou")))).length).toBe(1);
  });
  it("recusa nome vazio, nome repetido (sem acento e maiúscula) e preço ou duração inválidos", async () => {
    await expect(createService({ label: "  " }, g)).rejects.toThrow(/nome/i);
    await expect(createService({ label: "CORTE" }, g)).rejects.toThrow(/já existe/i);
    await expect(createService({ label: "Novo", priceCents: -1 }, g)).rejects.toThrow(/preço/i);
    await expect(createService({ label: "Novo", durationMin: 0 }, g)).rejects.toThrow(/duração/i);
    await expect(createService({ label: "Novo", description: "x".repeat(301) }, g)).rejects.toThrow(/300/);
  });
  it("nome de um serviço desativado: ativa de novo com os dados novos (nada duplica)", async () => {
    const [c] = await db.select().from(lists).where(and(eq(lists.kind, "service"), eq(lists.label, "Corte")));
    await db.update(lists).set({ active: false }).where(eq(lists.id, c.id));
    const { id } = await createService({ label: "corte", priceCents: 9_000 }, g);
    expect(id).toBe(c.id);
    expect(await row(id)).toMatchObject({ active: true, priceCents: 9_000, label: "Corte" });
  });
});

describe("Serviços: editar", () => {
  let corte = "";
  beforeEach(async () => { corte = (await db.select().from(lists).where(and(eq(lists.kind, "service"), eq(lists.label, "Corte"))))[0].id; });
  it("muda só o que veio: preço na linha não mexe no resto", async () => {
    await updateService(corte, { durationMin: 60, category: "Cabelo" }, g);
    await updateService(corte, { priceCents: 15_000 }, g);
    expect(await row(corte)).toMatchObject({ priceCents: 15_000, durationMin: 60, category: "Cabelo", label: "Corte" });
  });
  it("nome, descrição, ativo, folga, retorno e quem faz (troca a lista e mantém a comissão de quem ficou)", async () => {
    await db.insert(professionalServices).values({ professionalId: ana, serviceId: corte, commissionBp: 4000 });
    await updateService(corte, { label: "Corte feminino", description: "Inclui lavagem.", active: false, bufferMin: 10, cycleDays: 60, professionalIds: [ana, bia] }, g);
    expect(await row(corte)).toMatchObject({ label: "Corte feminino", description: "Inclui lavagem.", active: false, bufferMin: 10, cycleDays: 60 });
    expect(await prosOf(corte)).toEqual([ana, bia].sort());
    expect((await db.select().from(professionalServices).where(eq(professionalServices.professionalId, ana)))[0].commissionBp).toBe(4000);
    await updateService(corte, { professionalIds: [bia], description: "", cycleDays: 0 }, g);
    expect(await prosOf(corte)).toEqual([bia]);
    expect(await row(corte)).toMatchObject({ description: null, cycleDays: null });
  });
  it("recusa renomear para o nome de outro serviço e id que não é serviço", async () => {
    await expect(updateService(corte, { label: "coloracao" }, g)).rejects.toThrow(/já existe/i);
    const [q] = await db.insert(lists).values({ kind: "objection", label: "Caro" }).returning();
    await expect(updateService(q.id, { priceCents: 100 }, g)).rejects.toThrow(/não encontrado/i);
  });
});

describe("Serviços: a página", () => {
  it("lista todos (ativos e desativados) com quem faz, e as profissionais ativas para escolher", async () => {
    const { id } = await createService({ label: "Mãos", category: "Unhas", priceCents: 4_000, professionalIds: [bia] }, g);
    await db.update(professionals).set({ active: false }).where(eq(professionals.id, ana));
    const p = await listServicesPage();
    const maos = p.services.find((s) => s.id === id)!;
    expect(maos).toMatchObject({ label: "Mãos", category: "Unhas", priceCents: 4_000, active: true, professionalIds: [bia] });
    expect(p.services.length).toBeGreaterThanOrEqual(6);
    expect(p.professionals.map((x) => x.name)).toEqual(["Bia"]);
    expect(p.professionals[0]).toMatchObject({ color: "rosa", photoUrl: null });
  });
});

describe("Serviços: 'A IA pode citar' (0052)", () => {
  it("padrão sim; desligar tira da lista de serviços da IA sem desativar o serviço; a lista da tela devolve o campo", async () => {
    const { id } = await createService({ label: "Reunião com fornecedor", priceCents: 0 }, g);
    expect(await row(id)).toMatchObject({ aiCitavel: true, active: true });
    expect((await loadCasaData()).services.map((s) => s.label)).toContain("Reunião com fornecedor");
    await updateService(id, { aiCitavel: false }, g);
    expect(await row(id)).toMatchObject({ aiCitavel: false, active: true });
    expect((await listServicesPage()).services.find((s) => s.id === id)).toMatchObject({ aiCitavel: false });
    expect((await loadCasaData()).services.map((s) => s.label)).not.toContain("Reunião com fornecedor");
  });

  it("migration 0052 (dados): desliga só os internos/sem especialista pelo nome; não religa o que a gestão desligou; roda de novo sem mudar", async () => {
    const nomes = ["Serviço", "SERVIÇO", "Reunião com fornecedor", "Sessão de pacote método", "Cabelo Método Fiaes 1/2", "Aplicação Metodo Fiaes", "Sobrancelha design",
      "Corte", "Manutenção Método Fiaes", "Serviço de noiva", "Cabelo Método Fiaes", "Avaliação"];
    await db.delete(lists).where(eq(lists.kind, "service"));
    await db.insert(lists).values(nomes.map((label, i) => ({ kind: "service" as const, label: i === 1 ? `${label} ` : label, position: i })));
    await db.update(lists).set({ aiCitavel: false }).where(eq(lists.label, "Avaliação")); // a gestão desligou
    const stmt = readFileSync("drizzle/0052_ia_citavel.sql", "utf8").split("--> statement-breakpoint").find((x) => /UPDATE "lists"/.test(x))!;
    for (let k = 0; k < 2; k++) {
      await db.execute(sql.raw(stmt));
      const off = (await db.select({ label: lists.label }).from(lists).where(and(eq(lists.kind, "service"), eq(lists.aiCitavel, false)))).map((r) => r.label.trim()).sort();
      expect(off).toEqual(["Aplicação Metodo Fiaes", "Avaliação", "Cabelo Método Fiaes 1/2", "Reunião com fornecedor", "SERVIÇO", "Serviço", "Sessão de pacote método", "Sobrancelha design"].sort());
    }
  });
});

describe("Serviços: código fiscal próprio (Fase D)", () => {
  it("cTribNac (6 números) e NBS (9) são opcionais, sobrepõem o padrão e voltam a vazio", async () => {
    const { id } = await createService({ label: "Corte fiscal", fiscalCtribNac: "060101", fiscalNbs: "126021000" }, g);
    expect(await row(id)).toMatchObject({ fiscalCtribNac: "060101", fiscalNbs: "126021000" });
    expect((await listServicesPage()).services.find((s) => s.id === id)).toMatchObject({ fiscalCtribNac: "060101", fiscalNbs: "126021000" });
    await expect(updateService(id, { fiscalCtribNac: "6101" }, g)).rejects.toThrow("O código do serviço na nota (cTribNac) tem 6 números.");
    await expect(updateService(id, { fiscalNbs: "12" }, g)).rejects.toThrow("O NBS tem 9 números.");
    await updateService(id, { fiscalCtribNac: "", fiscalNbs: null }, g);
    expect(await row(id)).toMatchObject({ fiscalCtribNac: null, fiscalNbs: null });
  });
});
