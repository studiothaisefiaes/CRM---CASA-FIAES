import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "./index";
import { contacts, lists, loyaltyEntries, loyaltyPrograms } from "./schema";
import { resetDb } from "../../../test/db";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0082_fidelidade.sql"), "utf8");
const run = () => db.execute(sql.raw(SQL.replaceAll("--> statement-breakpoint", "")));
const programs = () => db.select().from(loyaltyPrograms).orderBy(asc(loyaltyPrograms.position));
const sorted = (xs: string[] | null) => (xs ? [...xs].sort() : xs);

describe("0083: fidelidade", () => {
  beforeEach(resetDb);

  it("traz os 3 programas da Casa, sem duplicar", async () => {
    const svc = async (label: string, category: string | null) => (await db.insert(lists).values({ kind: "service", label, category, position: 50 }).returning())[0].id;
    const finaliza = await svc("Escova modelada", "Finalização");
    const finaliza2 = await svc("Babyliss", "finalizações");
    const corte = (await db.select().from(lists).where(eq(lists.label, "Corte")))[0].id; // do seed de teste
    const corteFem = await svc("Corte feminino", "Cabelo");
    await svc("Recorte de franja", "Cabelo"); // não começa com "corte"
    const ritual = await svc("Ritual de Tratamento Fiaes", "Tratamento");
    await run(); await run();
    const p = await programs();
    expect(p.map((x) => x.name)).toEqual(["Fiel da Fiaes", "10x Você", "Aniversário"]);
    expect(p[0]).toMatchObject({ kind: "contagem", goal: 12, countsServiceIds: null, maxDiscountBp: 2000, rewardDiscountBp: 10000, active: true, countsPackageSessions: false, rewardReasonTemplate: "Fidelidade: {programa}" });
    expect(sorted(p[0].rewardServiceIds)).toEqual(sorted([finaliza, finaliza2]));
    expect(p[1]).toMatchObject({ kind: "contagem", goal: 10, maxDiscountBp: 2000, description: "Acompanhe pelo nosso sistema" });
    expect(sorted(p[1].countsServiceIds)).toEqual(sorted([corte, corteFem]));
    expect(sorted(p[1].rewardServiceIds)).toEqual(sorted([corte, corteFem]));
    expect(p[2]).toMatchObject({ kind: "aniversario", goal: null, rewardDiscountBp: 5000, rewardServiceIds: [ritual] });
  });

  it("rodar de novo não troca o que a Casa editou", async () => {
    await run();
    const [fiel] = await programs();
    await db.update(loyaltyPrograms).set({ goal: 15, active: false }).where(eq(loyaltyPrograms.id, fiel.id));
    await run();
    expect((await programs())[0]).toMatchObject({ goal: 15, active: false });
    expect(await programs()).toHaveLength(3);
  });

  it("delta zero e motivo desconhecido são recusados; a chave do Avec não repete", async () => {
    await run();
    const [fiel] = await programs();
    const [c] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571966000401" }).returning();
    await expect(db.insert(loyaltyEntries).values({ contactId: c.id, programId: fiel.id, delta: 0, reason: "ajuste" })).rejects.toThrow();
    await expect(db.insert(loyaltyEntries).values({ contactId: c.id, programId: fiel.id, delta: 1, reason: "outro" as "ajuste" })).rejects.toThrow();
    await db.insert(loyaltyEntries).values({ contactId: c.id, programId: fiel.id, delta: 3, reason: "saldo_avec", externalKey: "avec:0113:1" });
    await expect(db.insert(loyaltyEntries).values({ contactId: c.id, programId: fiel.id, delta: 3, reason: "saldo_avec", externalKey: "avec:0113:1" })).rejects.toThrow();
  });
});
