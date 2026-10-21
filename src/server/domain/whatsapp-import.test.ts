import { beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, contacts, dealEvents, deals, messages, outbox, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { mediaDir } from "../whatsapp/media";
import { applyWhatsappImport, previewWhatsappImport, stashUpload } from "./whatsapp-import";

const CHAT = [
  "02/03/2025 09:00 - As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta.",
  "02/03/2025 09:01 - Cliente Teste: Oi, queria marcar",
  "02/03/2025 09:01 - Cliente Teste: ok",
  "02/03/2025 09:01 - Cliente Teste: ok",
  "02/03/2025 09:05 - Casa Fiaes: Bom dia! Temos horário amanhã",
  "02/03/2025 09:06 - Cliente Teste: IMG-20250302-WA0001.jpg (arquivo anexado)",
  "olha esse cabelo",
  "02/03/2025 09:07 - Cliente Teste: <Mídia oculta>",
  "15/08/2026 10:00 - Cliente Teste: Já estou chegando",
].join("\n");
const enc = (s: string) => new TextEncoder().encode(s);
let uid = "", cid = "";
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Gestão Teste", email: "gestao@teste.local", role: "gestor", passwordHash: "x" }).returning();
  [{ id: cid }] = await db.insert(contacts).values({ name: "Cliente Teste", phoneE164: "+5571999990011" }).returning();
});
const count = async (t: typeof alerts | typeof outbox | typeof deals | typeof dealEvents | typeof tasks) => (await db.select({ n: sql<number>`count(*)::int` }).from(t))[0].n;
const upload = (name: string, bytes: Uint8Array) => stashUpload(uid, name, bytes);

describe("trazer conversa antiga do WhatsApp", () => {
  it("prévia: acha a cliente pelo telefone do arquivo, adivinha a Casa e não grava nada", async () => {
    const token = await upload("Conversa do WhatsApp com +55 71 99999-0011.txt", enc(CHAT));
    const p = await previewWhatsappImport(token, uid);
    expect(p).toMatchObject({ casa: "Casa Fiaes", total: 7, newCount: 7, existingCount: 0, contact: { id: cid, source: "arquivo" }, ignored: { system: 1, deleted: 0 } });
    expect(p.participants).toEqual([{ name: "Cliente Teste", count: 6 }, { name: "Casa Fiaes", count: 1 }]);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("acha pelo nome do contato; sem achar, pede a cliente; grupo é recusado", async () => {
    const byName = await previewWhatsappImport(await upload("_chat.txt", enc(CHAT)), uid);
    expect(byName.contact).toMatchObject({ id: cid, source: "nome" });
    const none = await previewWhatsappImport(await upload("_chat.txt", enc(CHAT.replaceAll("Cliente Teste", "Outra Pessoa"))), uid);
    expect(none.contact).toBeNull();
    await expect(applyWhatsappImport(none.token, uid)).rejects.toThrow("Escolha a cliente");
    const group = await upload("_chat.txt", enc(CHAT + "\n02/03/2025 10:00 - Terceira: oi"));
    await expect(previewWhatsappImport(group, uid)).rejects.toThrow("grupo");
  });

  it("grava com direção, hora e selo certos, sem lead, aviso, prazo, tarefa ou envio; o arquivo temporário some", async () => {
    const token = await upload("Conversa do WhatsApp com +55 71 99999-0011.txt", enc(CHAT));
    const r = await applyWhatsappImport(token, uid);
    expect(r).toMatchObject({ contactId: cid, inserted: 7, existing: 0 });
    const rows = await db.select().from(messages).orderBy(asc(messages.createdAt), asc(messages.importKey));
    expect(rows.every((m) => m.importedAt && m.dealId === null && m.channelId === null && m.contactId === cid)).toBe(true);
    const first = rows[0];
    expect(first).toMatchObject({ direction: "in", body: "Oi, queria marcar", kind: "text" });
    expect(first.createdAt.toISOString()).toBe("2025-03-02T12:01:00.000Z");
    expect(rows.find((m) => m.direction === "out")).toMatchObject({ body: "Bom dia! Temos horário amanhã", sentVia: "celular", fromPhone: true, sentByUserId: null });
    expect(rows.filter((m) => m.body === "ok")).toHaveLength(2); // duas iguais no mesmo minuto são duas mensagens
    expect(rows.find((m) => m.kind === "image")).toMatchObject({ body: "olha esse cabelo", mediaPath: null }); // .txt: sem o arquivo
    for (const t of [alerts, outbox, deals, dealEvents, tasks]) expect(await count(t)).toBe(0);
    expect((await db.select().from(auditLog)).map((a) => a.entity)).toEqual(["whatsapp_export"]);
    await expect(applyWhatsappImport(token, uid)).rejects.toThrow("expirou");
  });

  it("não duplica: o que o CRM já tem (mesma direção, mesmo texto, até 2 min) e a reimportação do mesmo arquivo", async () => {
    await db.insert(messages).values([
      { contactId: cid, direction: "in", body: "Já  estou CHEGANDO", createdAt: new Date("2026-08-15T13:01:30Z") }, // 10:01:30 em Salvador
      { contactId: cid, direction: "out", body: "Oi, queria marcar", createdAt: new Date("2025-03-02T12:01:00Z") }, // outra direção: não conta
    ]);
    const p = await previewWhatsappImport(await upload("_chat.txt", enc(CHAT)), uid, { contactId: cid });
    expect(p).toMatchObject({ newCount: 6, existingCount: 1, contact: { source: "escolhida" } });
    expect((await applyWhatsappImport(p.token, uid, { contactId: cid })).inserted).toBe(6);
    const again = await previewWhatsappImport(await upload("_chat.txt", enc(CHAT)), uid, { contactId: cid });
    expect(again).toMatchObject({ newCount: 0, existingCount: 7 });
    expect((await applyWhatsappImport(again.token, uid, { contactId: cid })).inserted).toBe(0);
    expect(await db.select().from(messages)).toHaveLength(8);
  });

  it("trocar quem é a Casa inverte a direção", async () => {
    const token = await upload("_chat.txt", enc(CHAT));
    await applyWhatsappImport(token, uid, { casa: "Cliente Teste", contactId: cid });
    const dirs = await db.select({ d: messages.direction }).from(messages).where(eq(messages.body, "Bom dia! Temos horário amanhã"));
    expect(dirs).toEqual([{ d: "in" }]);
  });

  it(".zip: guarda a foto como anexo da mensagem; arquivo de outra pessoa não abre", async () => {
    const zip = new JSZip();
    zip.file("Conversa do WhatsApp com Cliente Teste.txt", CHAT);
    zip.file("IMG-20250302-WA0001.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]));
    const token = await upload("Conversa do WhatsApp com Cliente Teste.zip", await zip.generateAsync({ type: "uint8array" }));
    const [{ id: other }] = await db.insert(users).values({ name: "Outra", email: "outra@teste.local", role: "atendente", passwordHash: "x" }).returning();
    await expect(previewWhatsappImport(token, other)).rejects.toThrow("expirou");
    const p = await previewWhatsappImport(token, uid);
    expect(p.media).toEqual({ files: 1, imported: 1, skipped: 1 });
    const r = await applyWhatsappImport(token, uid);
    expect(r.media).toBe(1);
    const [img] = await db.select().from(messages).where(eq(messages.kind, "image"));
    expect(img.mediaMime).toBe("image/jpeg");
    expect(existsSync(path.join(mediaDir(), img.mediaPath!))).toBe(true);
  });
});
