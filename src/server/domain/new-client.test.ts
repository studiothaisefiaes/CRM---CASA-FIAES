import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { contacts, deals, messages, outbox, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { createClient, DuplicatePhoneError, startNewConversation } from "./new-client";
import { recordInbound } from "./deals";

let ana = "";
beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});

describe("Nova cliente (Clientes)", () => {
  it("CPF opcional: com dígitos certos guarda só os números; inválido recusa e não cadastra", async () => {
    await expect(createClient({ name: "Cliente Cpf", phone: "(71) 90000-0309", cpf: "111.111.111-11" }, ana)).rejects.toThrow("CPF inválido");
    expect(await db.select().from(contacts)).toHaveLength(0);
    const { contactId } = await createClient({ name: "Cliente Cpf", phone: "(71) 90000-0309", cpf: "529.982.247-25" }, ana);
    expect((await db.select().from(contacts).where(eq(contacts.id, contactId)))[0].cpf).toBe("52998224725");
  });

  it("cadastra com nome e telefone; e-mail e aniversário opcionais; não abre conversa", async () => {
    const { contactId } = await createClient({ name: "Cliente Nova", phone: "(71) 90000-0301", email: "nova@exemplo.test", birthday: "14/11" }, ana);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, contactId));
    expect(c).toMatchObject({ name: "Cliente Nova", phoneE164: "+5571900000301", email: "nova@exemplo.test", birthDay: 14, birthMonth: 11, birthYear: null });
    expect(await db.select().from(deals)).toHaveLength(0);
  });

  it("telefone que já existe (também sem o 9) é recusado com a ficha existente", async () => {
    const [old] = await db.insert(contacts).values({ name: "Já Existe", phoneE164: "+557187650301" }).returning();
    const err = await createClient({ name: "Outra", phone: "71 98765-0301" }, ana).catch((e) => e);
    expect(err).toBeInstanceOf(DuplicatePhoneError);
    expect(err.existing).toEqual({ id: old.id, name: "Já Existe" });
  });

  it("nome, telefone, e-mail e aniversário inválidos dizem o que corrigir", async () => {
    await expect(createClient({ name: "", phone: "71 90000-0302" }, ana)).rejects.toThrow("Informe o nome");
    await expect(createClient({ name: "Fulana", phone: "123" }, ana)).rejects.toThrow("Telefone inválido");
    await expect(createClient({ name: "Fulana", phone: "71 90000-0302", email: "x" }, ana)).rejects.toThrow("E-mail inválido");
    await expect(createClient({ name: "Fulana", phone: "71 90000-0302", birthday: "31/02" }, ana)).rejects.toThrow("inválida");
  });
});

describe("Nova conversa (Atendimento)", () => {
  it("telefone novo: cadastra com o nome e abre a conversa sem mandar nada", async () => {
    const r = await startNewConversation({ phone: "71 90000-0303", name: "Pessoa Nova" }, ana);
    expect(r).toMatchObject({ created: true, newContact: true });
    const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
    expect(d.ownerId).toBe(ana);
    expect(await db.select().from(messages)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });

  it("cliente que já tem conversa aberta: leva a ela (acha pelo telefone em outro formato) e não troca o nome", async () => {
    const inbound = await recordInbound({ channelId: null, externalId: "N1", phoneRaw: "5571900000304", pushName: "Nome do Zap", body: "oi", at: new Date() });
    const r = await startNewConversation({ phone: "(71) 90000-0304", name: "Outro Nome" }, ana);
    expect(r).toMatchObject({ dealId: "dealId" in inbound ? inbound.dealId : "", created: false, newContact: false });
    expect((await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571900000304")))[0].name).toBe("Nome do Zap");
  });

  it("'Não é cliente' recusa (volta pela ficha)", async () => {
    await db.insert(contacts).values({ name: "Fornecedor", phoneE164: "+5571900000305", ignored: true });
    await expect(startNewConversation({ phone: "71 90000-0305" }, ana)).rejects.toThrow("Não é cliente");
  });
});
