import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { lists } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyServiceImport, parseServiceImport, planServiceImport, type ServiceImportBackup } from "./services-import";

beforeEach(async () => {
  await resetDb();
  await db.update(lists).set({ priceCents: 20_000, category: "CABELO" }).where(and(eq(lists.kind, "service"), eq(lists.label, "Corte")));
});
const svc = async (label: string) => (await db.select().from(lists).where(and(eq(lists.kind, "service"), eq(lists.label, label))))[0];

const ROWS = [
  { servico: "CORTE", categoria: "CABELO", precoCents: 26_400, duracaoMin: 60, descricao: "Inclui lavagem." },
  { servico: "Coloração", categoria: "COR", precoCents: 33_000, duracaoMin: null, descricao: null },
  { servico: "Manutenção Método Fiaes", categoria: "METODO FIAES", precoCents: 247_500, duracaoMin: null, descricao: "Remoção, confecção, aplicação e finalização." },
  { servico: "Revisão método", categoria: "METODO FIAES", precoCents: null, duracaoMin: null, descricao: null },
];

describe("importar serviços do Avec", () => {
  it("lê o JSON e recusa linha sem nome ou com preço que não é número", () => {
    expect(parseServiceImport({ servicos: ROWS })).toHaveLength(4);
    expect(() => parseServiceImport({ servicos: [{ servico: "" }] })).toThrow();
    expect(() => parseServiceImport({ servicos: [{ servico: "X", precoCents: "10" }] })).toThrow();
  });

  it("ensaio: casa pelo nome sem acento e maiúscula, cria os novos, só completa o que está vazio e aponta preço diferente sem trocar", async () => {
    const plan = await planServiceImport(parseServiceImport({ servicos: ROWS }));
    expect(plan.novos.map((n) => n.label)).toEqual(["Manutenção Método Fiaes", "Revisão método"]);
    expect(plan.novos[0]).toMatchObject({ category: "METODO FIAES", priceCents: 247_500, description: "Remoção, confecção, aplicação e finalização." });
    const corte = plan.atualizados.find((a) => a.label === "Corte")!;
    expect(corte.set).toEqual({ durationMin: 60, description: "Inclui lavagem." });
    expect(plan.atualizados.find((a) => a.label === "Coloração")!.set).toEqual({ priceCents: 33_000, category: "COR" });
    expect(plan.divergencias).toEqual([{ label: "Corte", crmCents: 20_000, avecCents: 26_400 }]);
    expect((await svc("Corte")).durationMin).toBeNull(); // ensaio não grava
  });

  it("aplica numa transação com backup, nunca apaga nem desativa, e um segundo ensaio vem vazio", async () => {
    await db.update(lists).set({ active: false }).where(and(eq(lists.kind, "service"), eq(lists.label, "Coloração")));
    const before = (await db.select().from(lists).where(eq(lists.kind, "service"))).length;
    let backup: ServiceImportBackup | null = null;
    const res = await applyServiceImport(await planServiceImport(parseServiceImport({ servicos: ROWS })), async (b) => { backup = b; });
    expect(res).toEqual({ criados: 2, atualizados: 2 });
    expect(backup!.antes.find((r) => r.label === "Corte")).toMatchObject({ durationMin: null, description: null, priceCents: 20_000 });
    expect(await svc("Corte")).toMatchObject({ priceCents: 20_000, durationMin: 60, description: "Inclui lavagem." });
    expect(await svc("Coloração")).toMatchObject({ active: false, priceCents: 33_000 });
    expect(await svc("Manutenção Método Fiaes")).toMatchObject({ active: true, priceCents: 247_500 });
    expect((await db.select().from(lists).where(eq(lists.kind, "service"))).length).toBe(before + 2);
    const again = await planServiceImport(parseServiceImport({ servicos: ROWS }));
    expect([again.novos.length, again.atualizados.length]).toEqual([0, 0]);
  });

  it("sem backup gravado, não aplica nada", async () => {
    await expect(applyServiceImport(await planServiceImport(parseServiceImport({ servicos: ROWS })), async () => { throw new Error("disco cheio"); })).rejects.toThrow("disco cheio");
    expect((await svc("Corte")).durationMin).toBeNull();
    expect(await svc("Revisão método")).toBeUndefined();
  });
});
