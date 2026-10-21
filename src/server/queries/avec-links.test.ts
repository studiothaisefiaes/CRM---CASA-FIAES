import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { linkAvecRows } from "./avec-links";

let rita = "", ana = "";
beforeEach(async () => {
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000501" }).returning())[0].id;
  ana = (await db.insert(contacts).values({ name: "Ana Única Fictícia", phoneE164: "+5571966000502" }).returning())[0].id;
  await db.insert(contacts).values([{ name: "Bia Repetida", phoneE164: "+5571966000503" }, { name: "Bia Repetida", phoneE164: "+5571966000504" }]);
});

it("acha a cliente pelo telefone e, sem telefone, pelo nome único; nome repetido ou desconhecido fica sem link", async () => {
  const r = await linkAvecRows(["Cliente", "Celular", "Serviço"], [
    ["Rita F.", "(71) 96600-0501", "Escova"],
    ["Ana Única Fictícia", "", "Corte"],
    ["Bia Repetida", "", "Corte"],
    ["Ninguém Fictícia", "", "Corte"],
  ]);
  expect(r.clientCol).toBe(0);
  expect(r.contactIds).toEqual([rita, ana, null, null]);
});

it("relatório sem coluna de cliente: nada vira link", async () => {
  expect(await linkAvecRows(["Profissional", "Total"], [["MAIARA", "100"]])).toEqual({ clientCol: -1, contactIds: [null] });
});
