import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { lists, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { createQuickReply, makeQuickReplyUniversal, quickRepliesFor, sendQuickReply, updateQuickReply } from "./quick-replies";

let sara = "", bia = "", gestora = "";
const atendente = (id: string) => ({ id, canShare: false });
const gestao = (id: string) => ({ id, canShare: true });
beforeEach(async () => {
  await resetDb();
  [{ id: sara }, { id: bia }, { id: gestora }] = await db.insert(users).values([
    { name: "Sara Lima", email: "sara-esc@teste.local", role: "atendente", passwordHash: "x" },
    { name: "Bia Souza", email: "bia-esc@teste.local", role: "atendente", passwordHash: "x" },
    { name: "Gê Gestora", email: "ge-esc@teste.local", role: "gestor", passwordHash: "x" },
  ]).returning();
});
const labels = async (uid: string) => (await quickRepliesFor(uid)).map((q) => `${q.label}${q.mine ? "*" : ""}`).filter((l) => l.includes("teste"));

describe("respostas prontas: universal ou só minha", () => {
  it("a minha só aparece para mim, com o selo; a universal aparece para todas", async () => {
    await createQuickReply({ label: "Minha Teste", body: "Oi, {primeiro_nome}!", scope: "minha" }, atendente(sara));
    await createQuickReply({ label: "geral-teste", body: "Bem-vinda!", scope: "universal" }, gestao(gestora));
    expect(await labels(sara)).toEqual(expect.arrayContaining(["minha-teste*", "geral-teste"]));
    expect(await labels(bia)).toEqual(["geral-teste"]);
  });
  it("só a gestão cria universal; a atendente que tenta recebe aviso", async () => {
    await expect(createQuickReply({ label: "x-teste", body: "a", scope: "universal" }, atendente(sara))).rejects.toThrow(/gestão/);
  });
  it("atalho já usado: aviso claro, sem sobrescrever a de outra pessoa", async () => {
    await createQuickReply({ label: "dup-teste", body: "da Sara", scope: "minha" }, atendente(sara));
    await expect(createQuickReply({ label: "dup-teste", body: "da Bia", scope: "minha" }, atendente(bia))).rejects.toThrow(/já existe/i);
    const [r] = await db.select().from(lists).where(eq(lists.label, "dup-teste"));
    expect(r.body).toBe("da Sara");
  });
  it("outra pessoa não edita a minha; eu e a gestão editamos", async () => {
    const { id } = await createQuickReply({ label: "ed-teste", body: "v1", scope: "minha" }, atendente(sara));
    await expect(updateQuickReply(id, { label: "ed-teste", body: "da Bia" }, atendente(bia))).rejects.toThrow(/não existe/);
    await updateQuickReply(id, { label: "ed-teste", body: "v2" }, atendente(sara));
    await updateQuickReply(id, { label: "ed-teste", body: "v3" }, gestao(gestora));
    expect((await db.select().from(lists).where(eq(lists.id, id)))[0].body).toBe("v3");
  });
  it("a atendente não edita uma universal", async () => {
    const { id } = await createQuickReply({ label: "uni-teste", body: "v1", scope: "universal" }, gestao(gestora));
    await expect(updateQuickReply(id, { label: "uni-teste", body: "mudei" }, atendente(sara))).rejects.toThrow(/gestão/);
  });
  it("a gestão transforma uma pessoal em universal; a atendente não", async () => {
    const { id } = await createQuickReply({ label: "vira-teste", body: "boa", scope: "minha" }, atendente(sara));
    await expect(makeQuickReplyUniversal(id, atendente(sara))).rejects.toThrow(/gestão/);
    await makeQuickReplyUniversal(id, gestao(gestora));
    expect(await labels(bia)).toEqual(["vira-teste"]);
    expect(await labels(sara)).toEqual(["vira-teste"]);
  });
  it("desativada some da lista do /", async () => {
    const { id } = await createQuickReply({ label: "off-teste", body: "x", scope: "minha" }, atendente(sara));
    await updateQuickReply(id, { label: "off-teste", body: "x", active: false }, atendente(sara));
    expect(await labels(sara)).toEqual([]);
  });
  it("ninguém envia a resposta pessoal de outra pessoa", async () => {
    const { id } = await createQuickReply({ label: "env-teste", body: "x", scope: "minha" }, atendente(sara));
    await expect(sendQuickReply("00000000-0000-4000-8000-000000000000", id, "x", bia)).rejects.toThrow(/não existe/);
  });
});
