import { beforeEach, expect, it } from "vitest";
import { db } from "../db";
import { contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { importChatguruRecord } from "./chatguru-import";

beforeEach(async () => { await resetDb(); });

it("“Post para URL” e CSV juntam a ficha: a segunda importação não apaga a primeira, e CPF/endereço nunca são gravados", async () => {
  await importChatguruRecord({ chat_id: "abc", celular: "5571999990081", nome: "Cliente Teste Um", responsavel_nome: "SARA", link_chat: "https://s12.chatguru.app/chats#abc",
    campos_personalizados: { "Cor preferida": "loiro", CPF: "111.222.333-44", "Endereço": "Rua Teste, 1" } });
  await importChatguruRecord({ chat_id: "csv-funil:+5571999990081", celular: "+5571999990081", campos_personalizados: { "Etapa no ChatGuru": "Orçamento" } });
  const [c] = await db.select().from(contacts);
  expect(c.importedFields?.chatguru).toMatchObject({ responsavel: "SARA", link: "https://s12.chatguru.app/chats#abc", campos: { "Cor preferida": "loiro", "Etapa no ChatGuru": "Orçamento" } });
  expect(JSON.stringify(c.importedFields)).not.toMatch(/111\.222|Rua Teste/);
});

it("o registro cru do “Post para URL” também não guarda CPF nem endereço", async () => {
  const { chatguruRecords } = await import("../db/schema");
  await importChatguruRecord({ chat_id: "x1", celular: "5571999990082", campos_personalizados: { CPF: "111.222.333-44", "Endereço": "Rua Teste, 1", Cor: "ruivo" } });
  const rows = await db.select().from(chatguruRecords);
  expect(JSON.stringify(rows)).not.toMatch(/111\.222|Rua Teste/);
  expect(JSON.stringify(rows)).toContain("ruivo");
});
