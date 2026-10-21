import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { searchPeople } from "./people-search";

beforeEach(async () => { await resetDb(); });

it("acha pelo telefone (com ou sem formatação), nome e CPF; nunca número oculto nem pessoa a mais (20/10)", async () => {
  await db.insert(contacts).values([
    { name: "Scarlete Fictícia", phoneE164: "+5573990000008", cpf: "52998224725" },
    { name: "Oculta", phoneE164: "lid:123" },
    { name: "Scarlete Filha", phoneE164: "pessoa:00000000-0000-4000-8000-000000000001" },
  ]);
  expect((await searchPeople("99000-0008")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect((await searchPeople("(73) 99000 0008")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect((await searchPeople("scarlete")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect((await searchPeople("529.982")).map((p) => p.name)).toEqual(["Scarlete Fictícia"]);
  expect(await searchPeople("sc")).toEqual([]);
});
