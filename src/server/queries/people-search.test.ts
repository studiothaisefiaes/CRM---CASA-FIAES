import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { searchPeople } from "./people-search";

beforeEach(async () => { await resetDb(); });

it("acha pelo telefone (com ou sem formatação), nome e CPF; nunca número oculto (20/10)", async () => {
  await db.insert(contacts).values([
    { name: "Scarlete Fictícia", phoneE164: "+5573990000008", cpf: "52998224725" },
    { name: "Oculta", phoneE164: "lid:123" },
    { name: "Scarlete Solta", phoneE164: "pessoa:00000000-0000-4000-8000-000000000001" }, // pessoa a mais sem titular: sem número, fora
  ]);
  expect((await searchPeople("99000-0008")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect((await searchPeople("(73) 99000 0008")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect((await searchPeople("scarlete")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect((await searchPeople("529.982")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect(await searchPeople("sc")).toEqual([]);
});

it("mãe e filha no mesmo número (21/10): pelo telefone aparecem as duas; a filha com o número da mãe, de quem é o número e a relação", async () => {
  const [mae] = await db.insert(contacts).values({ name: "Marta Fictícia", phoneE164: "+5573981610000" }).returning();
  await db.insert(contacts).values({ name: "Bruna Fictícia", phoneE164: "pessoa:00000000-0000-4000-8000-000000000002", sharesPhoneWith: mae.id, phoneRelation: "filha" });
  const porTelefone = await searchPeople("98161-0000");
  expect(porTelefone.map((p) => p.name)).toEqual(["Bruna Fictícia", "Marta Fictícia"]);
  expect(porTelefone[0]).toMatchObject({ phone: "+5573981610000", holderId: mae.id, holderName: "Marta Fictícia", relation: "filha" });
  expect(porTelefone[1]).toMatchObject({ holderId: null });
  expect((await searchPeople("bruna")).map((p) => p.phone)).toEqual(["+5573981610000"]);
});
