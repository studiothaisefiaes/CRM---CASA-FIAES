import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { listDuplicateSuspects } from "./duplicate-suspects";

// Dados SINTÉTICOS.
const mk = async (v: Partial<typeof contacts.$inferInsert> & { phoneE164: string }) => (await db.insert(contacts).values(v).returning())[0];
const pair = (r: Awaited<ReturnType<typeof listDuplicateSuspects>>[number]) => [r.aId, r.bId].sort().join("|");

beforeEach(async () => { await resetDb(); });

describe("possíveis duplicadas", () => {
  it("acha os sinais do par por nome (cpf, e-mail, aniversário, final do telefone); homônimo sem sinal fica fora", async () => {
    const a = await mk({ name: "Rita Souza Fictícia", phoneE164: "+5571966001001", cpf: "11144477735", email: "rita@exemplo.test", birthDay: 3, birthMonth: 5 });
    const b = await mk({ name: "rita souza fictícia", phoneE164: "+5571955001001", cpf: "11144477735", email: "rita@exemplo.test", birthDay: 3, birthMonth: 5 });
    const x = await mk({ name: "Lúcia Prado Teste", phoneE164: "+5571966002002" });
    await mk({ name: "Lucia Prado Teste", phoneE164: "+5571966003003" }); // homônimo, nenhum sinal
    await mk({ name: "Bia", phoneE164: "+5571966004004" }); // 1 palavra
    await mk({ name: "Bia", phoneE164: "+5571966004005", cpf: "x" });
    const r = await listDuplicateSuspects();
    expect(r).toHaveLength(1);
    expect(pair(r[0])).toBe([a.id, b.id].sort().join("|"));
    expect(r[0].signals).toEqual(expect.arrayContaining(["cpf", "email", "aniversario"]));
    expect(r.find((p) => [p.aId, p.bId].includes(x.id))).toBeUndefined();
  });

  it("final8: mesmo final de telefone com DDD ou DDI diferente", async () => {
    await mk({ name: "Carla Mendes Teste", phoneE164: "+5571966007777" });
    await mk({ name: "Carla Mendes Teste", phoneE164: "+5511966007777" });
    const r = await listDuplicateSuspects();
    expect(r).toHaveLength(1);
    expect(r[0].signals).toContain("final8");
  });

  it("e-mail usado por mais de 3 contatos não conta como sinal", async () => {
    for (let i = 0; i < 4; i++) await mk({ name: "Dora Lins Teste", phoneE164: `+557196600${5000 + i}`, email: "casa@exemplo.test" });
    expect(await listDuplicateSuspects()).toEqual([]);
  });

  it("'pessoa a mais' com contato próprio e código do Avec repetido", async () => {
    const mae = await mk({ name: "Marta Lima Teste", phoneE164: "+5571966008001" });
    const filha = await mk({ name: "Joana Lima Teste", phoneE164: "pessoa:11111111-1111-4111-8111-111111111111", sharesPhoneWith: mae.id, phoneRelation: "filha" });
    const joana = await mk({ name: "Joana Lima Teste", phoneE164: "+5571966008002" });
    const c1 = await mk({ name: "Ester Paz Um", phoneE164: "+5571966009001", importedFields: { avec: { codigo: "777" } } });
    const c2 = await mk({ name: "Ester P. Dois", phoneE164: "+5571966009002", importedFields: { avec: { codigo: "777" } } });
    const r = await listDuplicateSuspects();
    const byPair = new Map(r.map((p) => [pair(p), p.signals]));
    expect(byPair.get([filha.id, joana.id].sort().join("|"))).toEqual(["pessoa_a_mais"]);
    expect(byPair.get([c1.id, c2.id].sort().join("|"))).toEqual(["codigo_avec"]);
    expect(r).toHaveLength(2);
  });

  it("'pessoa a mais' só com o mesmo sobrenome: primeiro nome parecido sozinho não é sinal (22/10, 21.742 pares falsos)", async () => {
    const mae = await mk({ name: "Rosa Lima Teste", phoneE164: "+5571966008101" });
    await mk({ name: "Maria Souza Teste", phoneE164: "pessoa:22222222-2222-4222-8222-222222222222", sharesPhoneWith: mae.id, phoneRelation: "filha" });
    await mk({ name: "Mariana Costa Silva", phoneE164: "+5571966008102" });
    await mk({ name: "Maria", phoneE164: "+5571966008103" });
    expect(await listDuplicateSuspects()).toEqual([]);
  });

  it("contactId limita aos pares daquele cadastro", async () => {
    const a = await mk({ name: "Rita Souza Fictícia", phoneE164: "+5571966001001", cpf: "11144477735" });
    await mk({ name: "Rita Souza Fictícia", phoneE164: "+5571955001001", cpf: "11144477735" });
    await mk({ name: "Carla Mendes Teste", phoneE164: "+5571966007777" });
    await mk({ name: "Carla Mendes Teste", phoneE164: "+5511966007777" });
    expect(await listDuplicateSuspects()).toHaveLength(2);
    expect(await listDuplicateSuspects({ contactId: a.id })).toHaveLength(1);
  });
});

describe("busca do passo 'Com quem?'", () => {
  it("acha por nome ou por pedaço do telefone, sem o próprio e sem Spam; devolve só o final do número", async () => {
    const a = await mk({ name: "Rita Fictícia", phoneE164: "+5571966001001" });
    await mk({ name: "Rita Outra", phoneE164: "+5571966001002" });
    await mk({ name: "Rita Spam", phoneE164: "+5571966001003", kind: "spam" });
    const { searchMergeTargets } = await import("./duplicate-suspects");
    const r = await searchMergeTargets(a.id, "rita");
    expect(r.map((x) => x.name)).toEqual(["Rita Outra"]);
    expect(r[0].hint).toBe("final 1002");
    expect(JSON.stringify(r)).not.toContain("5571966");
    expect((await searchMergeTargets(a.id, "1002")).map((x) => x.name)).toEqual(["Rita Outra"]);
    expect(await searchMergeTargets(a.id, "r")).toEqual([]);
  });
});
