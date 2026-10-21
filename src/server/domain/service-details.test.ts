import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { lists, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { saveServiceDetails } from "./service-details";

let g = "", corte = "";
beforeEach(async () => {
  await resetDb();
  g = (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  corte = (await db.insert(lists).values({ kind: "service", label: "Corte X", position: 90 }).returning())[0].id;
});
const row = async (id: string) => (await db.select().from(lists).where(eq(lists.id, id)))[0];

describe("serviço: preço, duração e categoria", () => {
  it("salva só o que veio; vazio volta a 'não informado'", async () => {
    await saveServiceDetails(corte, { priceCents: 15_000, durationMin: 60, category: "  Cabelo " }, g);
    expect(await row(corte)).toMatchObject({ priceCents: 15_000, durationMin: 60, category: "Cabelo" });
    await saveServiceDetails(corte, { durationMin: 45 }, g);
    expect(await row(corte)).toMatchObject({ priceCents: 15_000, durationMin: 45, category: "Cabelo" });
    await saveServiceDetails(corte, { priceCents: null, category: "" }, g);
    expect(await row(corte)).toMatchObject({ priceCents: null, durationMin: 45, category: null });
  });
  it("recusa valores fora do razoável e o que não é serviço", async () => {
    await expect(saveServiceDetails(corte, { durationMin: 0 }, g)).rejects.toThrow("duração");
    await expect(saveServiceDetails(corte, { durationMin: 13 * 60 }, g)).rejects.toThrow("duração");
    await expect(saveServiceDetails(corte, { priceCents: -1 }, g)).rejects.toThrow("preço");
    await expect(saveServiceDetails(corte, { category: "x".repeat(61) }, g)).rejects.toThrow("categoria");
    const [motivo] = await db.select().from(lists).where(eq(lists.kind, "lost_reason")).limit(1);
    await expect(saveServiceDetails(motivo.id, { priceCents: 100 }, g)).rejects.toThrow("Serviço não encontrado");
  });
});

describe("serviço: folga depois", () => {
  it("de 0 a 120 minutos; vazio volta a 'sem folga'", async () => {
    await saveServiceDetails(corte, { bufferMin: 15 }, g);
    expect(await row(corte)).toMatchObject({ bufferMin: 15 });
    await saveServiceDetails(corte, { bufferMin: 0 }, g);
    expect(await row(corte)).toMatchObject({ bufferMin: 0 });
    await saveServiceDetails(corte, { bufferMin: null }, g);
    expect(await row(corte)).toMatchObject({ bufferMin: null });
  });
  it("recusa folga negativa, quebrada ou acima de 120", async () => {
    for (const v of [-5, 121, 7.5]) await expect(saveServiceDetails(corte, { bufferMin: v }, g)).rejects.toThrow("Confira a folga: de 0 a 120 minutos.");
  });
});
