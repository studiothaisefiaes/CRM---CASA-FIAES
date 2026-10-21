import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "../db";
import { contacts, deals, stages } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyNotesMerge, planNotesMerge, restoreNotesMerge } from "./notes-merge";

let rita = "";
beforeEach(async () => {
  await resetDb();
  rita = (await db.insert(contacts).values({ name: "Rita Fictícia", phoneE164: "+5571966000301", notes: "Antiga" }).returning())[0].id;
  const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
  const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
  await db.insert(deals).values([
    { contactId: rita, stageId: fechado.id, closedAt: new Date("2026-09-02T13:00:00Z"), createdAt: new Date("2026-09-01T13:00:00Z"), observations: "Alérgica a amônia" },
    { contactId: rita, stageId: lead.id, createdAt: new Date("2026-10-14T13:00:00Z"), observations: "Quer luzes" },
  ]);
});
const notas = async () => (await db.select({ n: contacts.notes }).from(contacts).where(eq(contacts.id, rita)))[0].n;

it("ensaio não grava; aplicar grava com backup; de novo não repete; desfazer volta ao texto de antes", async () => {
  const plano = await planNotesMerge();
  expect(plano).toHaveLength(1);
  expect(plano[0]).toMatchObject({ contactId: rita, before: "Antiga", added: 2 });
  expect(await notas()).toBe("Antiga");
  const file = path.join(mkdtempSync(path.join(tmpdir(), "anotacoes-")), "antes.json");
  expect(await applyNotesMerge(file)).toMatchObject({ updated: 1 });
  expect(await notas()).toContain("— Anotação da conversa de 14/10/2026 —\nQuer luzes");
  expect(JSON.parse(readFileSync(file, "utf8")).rows).toEqual([{ contactId: rita, before: "Antiga" }]);
  expect(await planNotesMerge()).toEqual([]);
  expect(await restoreNotesMerge(file)).toEqual({ restored: 1 });
  expect(await notas()).toBe("Antiga");
});

it("aplicar de novo com o mesmo arquivo de backup recusa e não apaga o backup de antes (o desfazer continua valendo)", async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), "anotacoes-")), "antes.json");
  await applyNotesMerge(file);
  await expect(applyNotesMerge(file)).rejects.toThrow(/já existe/);
  expect(JSON.parse(readFileSync(file, "utf8")).rows).toEqual([{ contactId: rita, before: "Antiga" }]);
  expect(await restoreNotesMerge(file)).toEqual({ restored: 1 });
  expect(await notas()).toBe("Antiga");
});
