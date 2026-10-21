import { beforeEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "../db";
import { contactTags, contacts, tags, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { addTag, bulkTagContacts, removeTag, tagsOf, listTags, listTagsAdmin, renameTag, setTagColor, mergeTags } from "./tags";

let ana = "", c1 = "", c2 = "";
beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
  [c1, c2] = (await db.insert(contacts).values([{ name: "Rita", phoneE164: "+5571999990001" }, { name: "Sol", phoneE164: "+5571999990002" }]).returning()).map((c) => c.id);
});

describe("etiquetas", () => {
  it("cria a etiqueta na hora e põe na cliente; o mesmo nome (com outra caixa ou espaços) reaproveita a etiqueta", async () => {
    const t = await addTag(c1, "  Noiva ", ana);
    expect(t.name).toBe("Noiva");
    const again = await addTag(c2, "noiva", ana);
    expect(again.id).toBe(t.id);
    expect((await listTags()).map((x) => [x.name, x.uses])).toEqual([["Noiva", 2]]);
  });
  it("pôr duas vezes não duplica; tirar some só daquela cliente", async () => {
    const t = await addTag(c1, "VIP", ana);
    await addTag(c1, "VIP", ana);
    await addTag(c2, "VIP", ana);
    expect((await tagsOf([c1])).get(c1)).toEqual([{ id: t.id, name: "VIP" }]);
    await removeTag(c1, t.id, ana);
    expect((await tagsOf([c1, c2])).get(c1)).toBeUndefined();
    expect((await tagsOf([c1, c2])).get(c2)).toEqual([{ id: t.id, name: "VIP" }]);
  });
  it("nome vazio ou longo demais é recusado com mensagem clara", async () => {
    await expect(addTag(c1, "   ", ana)).rejects.toThrow("Escreva o nome da etiqueta");
    await expect(addTag(c1, "x".repeat(31), ana)).rejects.toThrow("até 30 caracteres");
  });
  it("as etiquetas da cliente vêm em ordem alfabética", async () => {
    await addTag(c1, "VIP", ana);
    await addTag(c1, "Alisamento", ana);
    expect((await tagsOf([c1])).get(c1)!.map((t) => t.name)).toEqual(["Alisamento", "VIP"]);
  });
});

it("etiquetar em massa: cria a etiqueta uma vez, não duplica em quem já tem e conta só as novas", async () => {
  const [u] = await db.insert(users).values({ name: "Ana", email: "ana-tag@c.com", role: "atendente", passwordHash: "x" }).returning();
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await db.insert(contacts).values({ name: `Tag${i} Fictícia`, phoneE164: `+557196600070${i}` }).returning())[0].id);
  expect((await bulkTagContacts(ids.slice(0, 2), " noiva ", u.id)).tagged).toBe(2);
  const r = await bulkTagContacts(ids, "NOIVA", u.id);
  expect(r).toMatchObject({ tagged: 1, tag: { name: "noiva" } });
  expect(await db.select().from(contactTags).where(inArray(contactTags.contactId, ids))).toHaveLength(3);
});

describe("Configurações › Etiquetas", () => {
  it("lista com a contagem de clientes (mais usadas primeiro), a cor e quem é protegida", async () => {
    await addTag(c1, "VIP", ana); await addTag(c2, "VIP", ana); await addTag(c1, "Noiva", ana);
    expect((await listTagsAdmin()).map((t) => [t.name, t.uses, t.color, t.protected])).toEqual([["VIP", 2, null, false], ["Noiva", 1, null, false]]);
  });

  it("renomear: recusa vazio e nome que já existe (sugere Juntar); o histórico guarda de → para", async () => {
    const vip = await addTag(c1, "VIP", ana); await addTag(c2, "Noiva", ana);
    await expect(renameTag(vip.id, "  ", ana)).rejects.toThrow("Escreva o nome da etiqueta");
    await expect(renameTag(vip.id, "noiva", ana)).rejects.toThrow(/Já existe a etiqueta "noiva".*Juntar/);
    expect(await renameTag(vip.id, " Cliente VIP ", ana)).toMatchObject({ name: "Cliente VIP" });
  });

  it("cor: só #rrggbb ou sem cor", async () => {
    const vip = await addTag(c1, "VIP", ana);
    await expect(setTagColor(vip.id, "vermelho", ana)).rejects.toThrow("Escolha uma das cores");
    await setTagColor(vip.id, "#2F6B4F", ana);
    expect((await listTagsAdmin())[0].color).toBe("#2f6b4f");
    await setTagColor(vip.id, null, ana);
    expect((await listTagsAdmin())[0].color).toBeNull();
  });

  it("juntar: as clientes passam para a outra sem repetir e a antiga some", async () => {
    const vip = await addTag(c1, "VIP", ana);
    const vip2 = await addTag(c1, "vip cliente", ana); await addTag(c2, "vip cliente", ana);
    expect(await mergeTags(vip2.id, vip.id, ana)).toEqual({ moved: 1 }); // c1 já tinha VIP: não repete
    expect((await tagsOf([c1, c2])).get(c2)!.map((t) => t.name)).toEqual(["VIP"]);
    expect(await db.select().from(tags)).toHaveLength(1);
    expect(await db.select().from(contactTags)).toHaveLength(2);
    await expect(mergeTags(vip.id, vip.id, ana)).rejects.toThrow("Escolha outra etiqueta");
  });

  it("'Uso de imagem' não muda de nome nem some (a importação do Avec procura por ela); juntar outras NELA pode", async () => {
    const uso = await addTag(c1, "Uso de imagem", ana);
    const foto = await addTag(c2, "Autoriza foto", ana);
    await expect(renameTag(uso.id, "Imagem", ana)).rejects.toThrow(/não muda de nome/);
    await expect(mergeTags(uso.id, foto.id, ana)).rejects.toThrow(/junte as outras nela/);
    expect(await mergeTags(foto.id, uso.id, ana)).toEqual({ moved: 1 });
    expect((await listTagsAdmin()).map((t) => [t.name, t.uses, t.protected])).toEqual([["Uso de imagem", 2, true]]);
  });
});
