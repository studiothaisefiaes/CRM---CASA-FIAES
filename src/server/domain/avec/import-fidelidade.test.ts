import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { avecReports, contacts, loyaltyEntries, loyaltyPrograms, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { importa } from "../../../../test/avec-fixtures";
import { saveFuncoes } from "../funcoes";
import { loyaltyOf } from "../fidelidade";
import { detectFormat } from "./formats";
import { saveAvecLoyaltyProgram } from "../fidelidade-programas";

const NOW = new Date("2026-10-17T12:00:00Z");
// Fixture SINTÉTICA do 0113: nomes e telefones inventados.
const H0113 = ["Cliente", "Celular", "E-mail", "Ultima Pontuação", "Pontos Gerados", "Saldo Atual"];
let fiel: string, dez: string;

const cliente = async (name: string, phone: string) => (await db.insert(contacts).values({ name, phoneE164: phone }).returning())[0];
const entries = () => db.select().from(loyaltyEntries);

beforeEach(async () => {
  await resetDb();
  [fiel, dez] = (await db.insert(loyaltyPrograms).values([
    { name: "Fiel da Fiaes", kind: "contagem", goal: 12, position: 0 },
    { name: "10x Você", kind: "contagem", goal: 10, position: 1 },
  ]).returning()).map((p) => p.id);
});

describe("saldos de fidelidade do Avec (0113)", () => {
  it("o 0113 tem o papel fidelidade e não é lista de clientes", () => {
    const f = detectFormat(H0113);
    expect(f.roles).toContain("fidelidade");
    expect(f.roles).not.toContain("contatos");
    expect(detectFormat(["Nome", "Celular", "E-mail"]).roles).not.toContain("fidelidade");
  });

  it("saldo 23 vira 23 pontos de Fiel da Fiaes; importar de novo com 25 deixa 25 (não 48)", async () => {
    const ana = await cliente("Ana Teste", "+5571900000001");
    const r1 = await importa("f.xlsx", H0113, [["Ana Teste", "71900000001", "ana@exemplo.test", "10/10/2026", 23, 23]], { now: NOW });
    expect(r1.summary.saldosFidelidade).toBe(1);
    expect(await entries()).toMatchObject([{ contactId: ana.id, programId: fiel, delta: 23, reason: "saldo_avec", externalKey: `avec:fid:${ana.id}` }]);
    expect((await loyaltyOf(ana.id, NOW)).find((p) => p.programId === fiel)!.balance).toBe(23);

    await importa("f2.xlsx", H0113, [["Ana Teste", "71900000001", "ana@exemplo.test", "12/10/2026", 25, 25]], { now: NOW });
    expect(await entries()).toHaveLength(1);
    expect((await loyaltyOf(ana.id, NOW)).find((p) => p.programId === fiel)!.balance).toBe(25);
  });

  it("saldo 0 ou cliente sem telefone conhecido não grava", async () => {
    await cliente("Bia Teste", "+5571900000002");
    await importa("f.xlsx", H0113, [
      ["Bia Teste", "71900000002", "", "10/10/2026", 5, 0],
      ["Carla Inventada", "71900000099", "", "10/10/2026", 7, 7],
      ["Sem Telefone", "", "", "10/10/2026", 3, 3],
    ], { now: NOW });
    expect(await entries()).toHaveLength(0);
    expect(await db.select().from(contacts)).toHaveLength(1); // o 0113 não cria cliente
  });

  it("o saldo que cai para 0 na importação nova tira o saldo antigo", async () => {
    const bia = await cliente("Bia Teste", "+5571900000002");
    await importa("f.xlsx", H0113, [["Bia Teste", "71900000002", "", "10/10/2026", 5, 5]], { now: NOW });
    expect(await entries()).toHaveLength(1);
    await importa("f2.xlsx", H0113, [["Bia Teste", "71900000002", "", "11/10/2026", 5, 0]], { now: NOW });
    expect(await entries()).toHaveLength(0);
    expect((await loyaltyOf(bia.id, NOW)).find((p) => p.programId === fiel)!.balance).toBe(0);
  });

  it("trocar o programa de destino muda onde o saldo cai", async () => {
    const ana = await cliente("Ana Teste", "+5571900000001");
    await importa("f.xlsx", H0113, [["Ana Teste", "71900000001", "", "10/10/2026", 4, 4]], { now: NOW });
    expect((await entries())[0].programId).toBe(fiel);
    await saveAvecLoyaltyProgram(dez, null);
    await importa("f2.xlsx", H0113, [["Ana Teste", "71900000001", "", "11/10/2026", 4, 4]], { now: NOW });
    const e = await entries();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ contactId: ana.id, programId: dez, delta: 4 });
  });

  it("função Fidelidade desligada não grava nada", async () => {
    await cliente("Ana Teste", "+5571900000001");
    const [u] = await db.insert(users).values({ email: "t@teste.com", name: "T", passwordHash: "x" }).returning();
    await saveFuncoes({ fidelidade: false }, u.id);
    const r = await importa("f.xlsx", H0113, [["Ana Teste", "71900000001", "", "10/10/2026", 4, 4]], { now: NOW });
    expect(r.summary.saldosFidelidade).toBe(0);
    expect(r.summary.fidelidadeDesligada).toBe(1);
    expect(await entries()).toHaveLength(0);
  });

  it("guarda o relatório com o mesmo saneamento dos outros de cliente (sem CPF, endereço etc.)", async () => {
    await cliente("Ana Teste", "+5571900000001");
    await importa("f.xlsx", [...H0113, "CPF"], [["Ana Teste", "71900000001", "", "10/10/2026", 4, 4, "000.000.000-00"]], { now: NOW });
    const [rep] = await db.select().from(avecReports);
    expect(rep.columns).not.toContain("CPF");
    expect(JSON.stringify(rep.rows)).not.toContain("000.000.000-00");
  });

  it("programa de destino sem configuração: o padrão é o Fiel da Fiaes; programa que sumiu recusa o arquivo com mensagem", async () => {
    await cliente("Ana Teste", "+5571900000001");
    await db.delete(loyaltyPrograms).where(eq(loyaltyPrograms.id, dez));
    await db.delete(loyaltyPrograms).where(eq(loyaltyPrograms.id, fiel));
    await expect(importa("f.xlsx", H0113, [["Ana Teste", "71900000001", "", "10/10/2026", 4, 4]], { now: NOW })).rejects.toThrow(/Fidelidade/);
  });
});
