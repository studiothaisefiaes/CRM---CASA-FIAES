import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contactNotes, contactTags, contacts, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyChatguruCsv, previewChatguruCsv } from "./chatguru-csv-import";
import { notesOf } from "./notes";

const CHATS = "﻿Nome;WhatsApp;Link;Data de cadastro;Última mensagem;Tags;CPF;Endereço\n" +
  "Cliente Teste Um;5571999990011;https://s12.chatguru.app/chats#6512aa;10/05/2025;oi;VIP, Noiva;123.456.789-00;Rua Teste, 10\n" +
  "Cliente Teste Dois;(71) 99999-0012;;;tudo bem;;;\n" +
  "Sem Número;abc;;;;Promo;;\n";
const FUNIL = "Nome,Número,Etapa,Responsável\nCliente Teste Um,5571999990011,Orçamento,SARA\n";
const NOTAS = "Número;Data;Autor;Anotação\n5571999990011;12/10/2026 14:30;SARA;Cliente pediu orçamento de mega hair\n5571999990011;12/10/2026 14:30;SARA;Cliente pediu orçamento de mega hair\n";
let uid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Thaíse Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
});
const um = async () => (await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990011")))[0];

describe("importar a ficha do ChatGuru", () => {
  it("prévia: o que vai entrar, sem gravar nada", async () => {
    const p = await previewChatguruCsv(CHATS);
    expect(p).toMatchObject({ kind: "chats", total: 3, valid: 2, existing: 0, newContacts: 2, tags: ["Noiva", "VIP"], removedColumns: ["CPF", "Endereço"], ignoredColumns: ["Última mensagem"] });
    expect(p.invalid).toEqual([{ line: 4, value: "abc" }]);
    expect(await db.select().from(contacts)).toHaveLength(0);
  });

  it("aplica: cria os contatos sem lead, com etiquetas e ficha; CPF e endereço nunca são gravados", async () => {
    const r = await applyChatguruCsv(CHATS, uid);
    expect(r).toMatchObject({ kind: "chats", contacts: 2, created: 2, invalid: 1 });
    expect(await db.select().from(deals)).toHaveLength(0);
    const c = await um();
    expect(c.importedFields?.chatguru).toMatchObject({ link: "https://s12.chatguru.app/chats#6512aa", desde: "2025-05-10" });
    expect(JSON.stringify(await db.select().from(contacts))).not.toMatch(/123\.456|Rua Teste/);
    expect((await db.select().from(contactTags).where(eq(contactTags.contactId, c.id)))).toHaveLength(2);
  });

  it("reimportar não duplica etiquetas, contatos nem notas", async () => {
    await applyChatguruCsv(CHATS, uid);
    await applyChatguruCsv(CHATS, uid);
    expect(await db.select().from(contacts)).toHaveLength(2);
    expect(await db.select().from(contactTags)).toHaveLength(2);
    await applyChatguruCsv(NOTAS, uid);
    await applyChatguruCsv(NOTAS, uid);
    expect(await db.select().from(contactNotes)).toHaveLength(1);
  });

  it("funil depois dos chats: a etapa de lá e o responsável entram sem apagar o link", async () => {
    await applyChatguruCsv(CHATS, uid);
    await applyChatguruCsv(FUNIL, uid);
    expect((await um()).importedFields?.chatguru).toMatchObject({ link: "https://s12.chatguru.app/chats#6512aa", responsavel: "SARA", campos: { "Etapa no ChatGuru": "Orçamento" } });
  });

  it("anotações viram notas internas da cliente, com a autora de lá e a data certa", async () => {
    await applyChatguruCsv(NOTAS, uid);
    const [n] = await notesOf((await um()).id);
    expect(n).toMatchObject({ body: "Cliente pediu orçamento de mega hair", authorName: "SARA", source: "chatguru" });
    expect(n.createdAt.toISOString()).toBe("2026-10-12T17:30:00.000Z");
  });
});
