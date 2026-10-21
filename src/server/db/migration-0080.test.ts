import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "./index";
import { contactTags, contacts, tags } from "./schema";
import { resetDb } from "../../../test/db";

const SQL = readFileSync(path.join(__dirname, "../../../drizzle/0080_uso_de_imagem.sql"), "utf8");
const run = () => db.execute(sql.raw(SQL.replaceAll("--> statement-breakpoint", "")));

describe("0081: uso de imagem", () => {
  beforeEach(resetDb);

  it("quem tem a etiqueta Uso de imagem passa a ter image_use = 'sim' (data vazia); quem não tem fica null; a etiqueta fica; roda 2 vezes", async () => {
    const [com, sem] = await db.insert(contacts).values([{ name: "Com Etiqueta", phoneE164: "+5571966000201" }, { name: "Sem Etiqueta", phoneE164: "+5571966000202" }]).returning();
    const [t] = await db.insert(tags).values({ name: "USO DE IMAGEM" }).returning();
    await db.insert(contactTags).values({ contactId: com.id, tagId: t.id });
    await run(); await run();
    const [a] = await db.select().from(contacts).where(eq(contacts.id, com.id));
    const [b] = await db.select().from(contacts).where(eq(contacts.id, sem.id));
    expect([a.imageUse, a.imageUseOn, b.imageUse, b.imageUseOn]).toEqual(["sim", null, null, null]);
    expect(await db.select().from(tags).where(eq(tags.id, t.id))).toHaveLength(1);
  });

  it("a coluna só aceita sim ou nao", async () => {
    await run();
    await expect(db.insert(contacts).values({ name: "X", phoneE164: "+5571966000203", imageUse: "talvez" as never })).rejects.toThrow();
  });
});
