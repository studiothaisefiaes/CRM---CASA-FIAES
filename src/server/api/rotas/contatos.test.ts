import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { auditLog, contacts } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { chamar, chaveDe, pessoa } from "../../../../test/api-fixtures";
import { __zerarLimites } from "../limite";
import { alterarContato, criarContato, listarContatos, verContato } from "./contatos";

beforeEach(async () => { await resetDb(); __zerarLimites(); });

describe("contatos", () => {
  it("cadastra pela função da tela (sem conversa, sem mensagem), acha por nome e telefone, e recusa telefone repetido com 409", async () => {
    const u = await pessoa("atendente");
    const k = await chaveDe(u.id, ["ler", "escrever"]);
    const r = await chamar(criarContato, { chave: k, body: { nome: "Marina Teste", telefone: "71 98877-0001", aniversario: "14/11", email: "marina@exemplo.com" } });
    expect(r.status).toBe(201);
    const c = r.json.dados as { id: string; telefone: string; aniversario: string; cliente: boolean };
    expect(c).toMatchObject({ telefone: "+5571988770001", aniversario: "14/11", nome: "Marina Teste" });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, "cadastrou_cliente"), eq(auditLog.entityId, c.id)))).toHaveLength(1);

    const dup = await chamar(criarContato, { chave: k, body: { nome: "Outra", telefone: "+55 71 8877-0001" } });
    expect(dup.status).toBe(409);
    expect(dup.json.erro).toContain(c.id);

    const porNome = await chamar(listarContatos, { chave: k, query: { q: "marina" } });
    expect((porNome.json.dados as { id: string }[]).map((x) => x.id)).toEqual([c.id]);
    const porTel = await chamar(listarContatos, { chave: k, query: { q: "(71) 98877-0001" } });
    expect((porTel.json.dados as { id: string }[]).map((x) => x.id)).toEqual([c.id]);
    expect((await chamar(verContato, { chave: k, params: { id: c.id } })).json.dados).toMatchObject({ id: c.id, etiquetas: [] });
  });

  it("edita só o que mudou (auditado), apaga com vazio; uso de imagem pede a permissão própria", async () => {
    const u = await pessoa(["contatos.ver", "contatos.editar"]);
    const k = await chaveDe(u.id, ["escrever"]);
    const [c] = await db.insert(contacts).values({ name: "Paula", phoneE164: "+5571988770002", notes: "antiga" }).returning();
    const r = await chamar(alterarContato, { chave: k, params: { id: c.id }, body: { nome: "Paula Souza", apelido: "Paulinha", observacoes: "" } });
    expect(r.status).toBe(200);
    expect(r.json.dados).toMatchObject({ nome: "Paula Souza", apelido: "Paulinha", observacoes: null });
    expect((r.json.dados as { alterados: string[] }).alterados.sort()).toEqual(["name", "nickname", "notes"]);
    const [a] = await db.select().from(auditLog).where(and(eq(auditLog.action, "atualizou_contato"), eq(auditLog.entityId, c.id)));
    expect(a.userId).toBe(u.id);
    expect((await chamar(alterarContato, { chave: k, params: { id: c.id }, body: { uso_de_imagem: "sim" } })).status).toBe(403);
    expect((await chamar(alterarContato, { chave: k, params: { id: c.id }, body: { cpf: "123" } })).status).toBe(400);
  });

  it("ler pede contatos.ver; escrever pede contatos.editar; Spam só com tipo=spam", async () => {
    const soVer = await chaveDe((await pessoa(["contatos.ver"])).id);
    await db.insert(contacts).values([{ name: "Normal", phoneE164: "+5571988770003" }, { name: "Spammer", phoneE164: "+5571988770004", kind: "spam" }]);
    expect((await chamar(listarContatos, { chave: soVer })).json.dados).toHaveLength(1);
    expect((await chamar(listarContatos, { chave: soVer, query: { tipo: "spam" } })).json.dados).toMatchObject([{ nome: "Spammer", tipo: "spam" }]);
    expect((await chamar(criarContato, { chave: soVer, body: { nome: "Nova", telefone: "71988770005" } })).status).toBe(403);
    const semVer = await chaveDe((await pessoa(["atendimento.ver"])).id);
    expect((await chamar(listarContatos, { chave: semVer })).status).toBe(403);
  });
});
