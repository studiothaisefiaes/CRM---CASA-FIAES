import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contactStats, contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { exportContactRows } from "./contacts-csv";
import { listContacts } from "./contacts";

let rita = "", fia = "";
beforeEach(async () => {
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000801" }).returning())[0].id;
  fia = (await db.insert(contacts).values({ name: "Fia Fictícia", phoneE164: "+5571966000802" }).returning())[0].id;
  await db.insert(contactStats).values([{ contactId: rita, totalCents: 50_000 }, { contactId: fia, totalCents: 7_000 }]);
});

it("exportar com 'ver valores' traz o total gasto de cada uma (a SQL com a lista de ids funciona)", async () => {
  const rows = await exportContactRows({}, true);
  expect(Object.fromEntries(rows.map((r) => [r.name, r.totalCents]))).toEqual({ "Rita Fictícia": 50_000, "Fia Fictícia": 7_000 });
});

it("só as selecionadas (ids) entram na lista e no CSV", async () => {
  expect((await listContacts({ ids: [fia] })).rows.map((r) => r.name)).toEqual(["Fia Fictícia"]);
  expect((await exportContactRows({ ids: [rita] }, false)).map((r) => [r.name, r.totalCents])).toEqual([["Rita Fictícia", null]]);
});
