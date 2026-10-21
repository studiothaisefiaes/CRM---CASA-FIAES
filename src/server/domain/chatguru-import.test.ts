import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { chatguruRecords, contacts } from "../db/schema";
import { resetDb } from "../../../test/db";
import { tagsOf } from "./tags";
import { importChatguruRecord } from "./chatguru-import";

const sample = (over: Record<string, unknown> = {}) => ({
  nome: "Rita Souza", celular: "5571999887766", chat_id: "abc123", tags: ["VIP", "Progressiva"],
  campos_personalizados: { Aniversario: "14/03", Cabelo: "longo" }, responsavel_nome: "Sara", link_chat: "https://s18.chatguru.app/chats#abc123",
  chat_created: "2025-02-10 10:00:00.000000", texto_mensagem: "", tipo_mensagem: "chat", ...over,
});

beforeEach(async () => { await resetDb(); });

describe("importar ficha do ChatGuru", () => {
  it("cria o contato (sem lead), põe as etiquetas e guarda campos, responsável e data de lá", async () => {
    const r = await importChatguruRecord(sample());
    expect(r).toMatchObject({ ok: true, created: true });
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999887766"));
    expect(c.name).toBe("Rita Souza");
    expect(c.importedFields?.chatguru).toMatchObject({ campos: { Aniversario: "14/03", Cabelo: "longo" }, responsavel: "Sara", desde: "2025-02-10", link: "https://s18.chatguru.app/chats#abc123" });
    expect((await tagsOf([c.id])).get(c.id)!.map((t) => t.name)).toEqual(["Progressiva", "VIP"]);
    const [rec] = await db.select().from(chatguruRecords).where(eq(chatguruRecords.chatId, "abc123"));
    expect(rec.appliedAt).not.toBeNull();
  });

  it("contato que já existe (veio do WhatsApp) é completado, sem trocar o nome que a equipe deu", async () => {
    await db.insert(contacts).values({ name: "Rita (cliente fiel)", phoneE164: "+5571999887766" });
    const r = await importChatguruRecord(sample());
    expect(r).toMatchObject({ ok: true, created: false });
    const rows = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999887766"));
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Rita (cliente fiel)");
  });

  it("mandar de novo atualiza (não duplica etiqueta nem registro)", async () => {
    await importChatguruRecord(sample());
    await importChatguruRecord(sample({ tags: ["VIP", "Noiva"], campos_personalizados: { Cabelo: "curto" } }));
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999887766"));
    expect((await tagsOf([c.id])).get(c.id)!.map((t) => t.name)).toEqual(["Noiva", "Progressiva", "VIP"]);
    expect(c.importedFields?.chatguru?.campos).toMatchObject({ Cabelo: "curto" }); // Lote 5: a ficha se junta (os campos de antes ficam)
    expect(await db.select().from(chatguruRecords)).toHaveLength(1);
  });

  it("sem número válido: guarda o registro com o erro e não cria nada", async () => {
    const r = await importChatguruRecord(sample({ celular: "abc", chat_id: "x9" }));
    expect(r).toMatchObject({ ok: false });
    const [rec] = await db.select().from(chatguruRecords).where(eq(chatguruRecords.chatId, "x9"));
    expect(rec.error).toContain("número");
    expect(await db.select().from(contacts)).toHaveLength(0);
  });
});
