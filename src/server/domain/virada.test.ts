import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, channels, contacts, messages, satisfactionAnswers, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { setSetting } from "../../../test/agenda-fixtures";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { saveFuncao } from "./funcoes";
import { AFTER_VISIT_DEFAULTS, SATISFACTION_OPTIONS } from "@/lib/after-visit";
import { VIRADA_ITENS } from "@/lib/virada";
import { getVirada, saveVirada, sendViradaTest, viradaPreview } from "./virada";

const H = 3_600_000;
const NOW = new Date("2026-10-19T13:00:00Z"); // segunda, 10h em Salvador (Casa fechada: a Virada é de preferência na segunda)
const PHONE = "+5571988887777";
const GOOGLE = "https://g.page/r/casa-fiaes/review";

// Provider falso: nenhum teste fala com a Evolution nem envia WhatsApp de verdade.
const sentTexts: { to: string; text: string }[] = [];
const sentPolls: { to: string; title: string; options: string[] }[] = [];
let failSend = false;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, to: string, text: string) => {
    if (failSend) throw Object.assign(new Error("Evolution 400"), { status: 400 });
    sentTexts.push({ to, text }); return { externalId: `OUT${sentTexts.length}` };
  },
  sendPoll: async (_i: string, to: string, title: string, options: string[]) => { sentPolls.push({ to, title, options }); return { externalId: `POLL${sentPolls.length}` }; },
};

let g = "";
const testeHa = (alvo: "lembrete" | "depois", horas: number, data: Record<string, unknown> = {}) =>
  db.insert(auditLog).values({ userId: g, action: "teste_virada", entity: "virada", entityId: alvo, data, createdAt: new Date(NOW.getTime() - horas * H) });
const testes = (alvo: string) => db.select().from(auditLog).where(and(eq(auditLog.action, "teste_virada"), eq(auditLog.entityId, alvo)));

beforeEach(async () => {
  sentTexts.length = 0; sentPolls.length = 0; failSend = false;
  await resetDb();
  setWhatsappProvider(fake);
  [{ id: g }] = await db.insert(users).values({ name: "Thaise Fiaes", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" });
});
afterEach(() => { setWhatsappProvider(null); });

describe("saveVirada: o checklist fica gravado e auditado", () => {
  it("grava alvo, marcados, quem e quando em settings.virada_<alvo>, com auditoria", async () => {
    expect(await getVirada("lembrete")).toBeNull();
    await saveVirada("lembrete", ["chatguru_lembrete", "avec_confirmacao"], g, NOW);
    expect(await getVirada("lembrete")).toEqual({ alvo: "lembrete", marcados: ["chatguru_lembrete", "avec_confirmacao"], quem: g, quando: NOW.toISOString() });
    const [row] = await db.select().from(settings).where(eq(settings.key, "virada_lembrete"));
    expect(row.value).toMatchObject({ alvo: "lembrete", marcados: ["chatguru_lembrete", "avec_confirmacao"] });
    expect(await db.select().from(auditLog).where(eq(auditLog.entityId, "virada_lembrete"))).toHaveLength(1);
  });

  it("recusa item que não é do alvo e item desconhecido", async () => {
    await expect(saveVirada("depois", ["chatguru_lembrete"], g, NOW)).rejects.toThrow("Passo desconhecido.");
    await expect(saveVirada("lembrete", ["qualquer"], g, NOW)).rejects.toThrow("Passo desconhecido.");
    expect(await getVirada("depois")).toBeNull();
  });

  it("teste_enviado só conta se houve um teste de verdade nas últimas 24 h (audit 'teste_virada')", async () => {
    await expect(saveVirada("lembrete", [...VIRADA_ITENS.lembrete], g, NOW)).rejects.toThrow("Mande o teste");
    await testeHa("lembrete", 25);
    await expect(saveVirada("lembrete", [...VIRADA_ITENS.lembrete], g, NOW)).rejects.toThrow("Mande o teste");
    await testeHa("depois", 1); // o teste do Depois do atendimento não vale para o lembrete
    await expect(saveVirada("lembrete", [...VIRADA_ITENS.lembrete], g, NOW)).rejects.toThrow("Mande o teste");
    await testeHa("lembrete", 23);
    await saveVirada("lembrete", [...VIRADA_ITENS.lembrete], g, NOW);
    expect((await getVirada("lembrete"))?.marcados).toEqual([...VIRADA_ITENS.lembrete]);
  });

  it("'O teste vale por' (Funções › Virada) muda o prazo: com 48 h, o teste de 25 h atrás vale", async () => {
    await testeHa("lembrete", 25);
    await expect(saveVirada("lembrete", [...VIRADA_ITENS.lembrete], g, NOW)).rejects.toThrow("Mande o teste");
    await saveFuncao("virada", { params: { horas_validade_teste: 48 } }, g);
    await saveVirada("lembrete", [...VIRADA_ITENS.lembrete], g, NOW);
    expect((await getVirada("lembrete"))?.marcados).toContain("teste_enviado");
  });
});

describe("sendViradaTest: o texto de verdade no WhatsApp digitado (provider falso)", () => {
  it("lembrete: manda a prévia (visita de exemplo amanhã) para o número, que vira contato de Equipe, e grava o teste", async () => {
    const preview = await viradaPreview("lembrete", { nome: "Thaise Fiaes", now: NOW });
    expect(preview.kind).toBe("text");
    expect(preview.text).toContain("Thaise");
    expect(preview.text).toContain("📅 *terça-feira, 20/10*\n⏰ às *10h*"); // amanhã
    const r = await sendViradaTest("lembrete", "(71) 98888-7777", g, { now: NOW });
    expect(sentTexts).toEqual([{ to: PHONE, text: preview.text }]);
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, PHONE));
    expect(c.kind).toBe("equipe");
    expect(r).toEqual({ dealId: expect.any(String) });
    // Aparece na conversa, como tudo que sai.
    expect((await db.select().from(messages).where(eq(messages.dealId, r.dealId))).map((m) => [m.direction, m.body])).toEqual([["out", preview.text]]);
    const [t] = await testes("lembrete");
    expect(t).toMatchObject({ userId: g, entity: "virada", data: { phone: PHONE, dealId: r.dealId } });
    expect(t.createdAt.toISOString()).toBe(NOW.toISOString());
  });

  it("número de uma cliente ou de um fornecedor: recusado com o nome, nada sai e o contato não muda (fix 1)", async () => {
    await db.insert(contacts).values({ name: "Paula Souza", phoneE164: PHONE, kind: "cliente" });
    await expect(sendViradaTest("lembrete", "(71) 98888-7777", g, { now: NOW })).rejects.toThrow("Esse número é de uma cliente (Paula Souza). Use o WhatsApp da gestora.");
    expect((await db.select().from(contacts).where(eq(contacts.phoneE164, PHONE)))[0].kind).toBe("cliente");
    await db.update(contacts).set({ kind: "fornecedor", name: "Distribuidora" }).where(eq(contacts.phoneE164, PHONE));
    await expect(sendViradaTest("lembrete", PHONE, g, { now: NOW })).rejects.toThrow("Esse número é de um fornecedor (Distribuidora). Use o WhatsApp da gestora.");
    expect((await db.select().from(contacts).where(eq(contacts.phoneE164, PHONE)))[0].kind).toBe("fornecedor");
    expect(sentTexts).toHaveLength(0);
    expect(await testes("lembrete")).toHaveLength(0);
    expect(await db.select().from(messages)).toHaveLength(0);
  });

  it("número que já é de Equipe: o teste sai", async () => {
    await db.insert(contacts).values({ name: "Thaise", phoneE164: PHONE, kind: "equipe" });
    await sendViradaTest("lembrete", PHONE, g, { now: NOW });
    expect(sentTexts).toHaveLength(1);
  });

  it("número marcado como Spam: recusado, nada sai e o teste não conta", async () => {
    await db.insert(contacts).values({ name: "Spam", phoneE164: PHONE, kind: "spam" });
    await expect(sendViradaTest("lembrete", PHONE, g, { now: NOW })).rejects.toThrow("Esse número está marcado como spam");
    expect(sentTexts).toHaveLength(0);
    expect(await testes("lembrete")).toHaveLength(0);
  });

  it("número inválido e envio que falha: recusado com o motivo, e o teste não conta", async () => {
    await expect(sendViradaTest("lembrete", "123", g, { now: NOW })).rejects.toThrow("WhatsApp inválido");
    failSend = true;
    await expect(sendViradaTest("lembrete", PHONE, g, { now: NOW })).rejects.toThrow();
    expect(await testes("lembrete")).toHaveLength(0);
  });

  it("Depois do atendimento: agradecimento manda o texto com o link; pesquisa manda a enquete de 1 a 5 (sem virar pesquisa de verdade)", async () => {
    await expect(sendViradaTest("depois", PHONE, g, { now: NOW, modo: "agradecimento" })).rejects.toThrow("Ponha o link da Avaliação no Google");
    await setSetting("depois_atendimento", { ...AFTER_VISIT_DEFAULTS, linkGoogle: GOOGLE });
    await sendViradaTest("depois", PHONE, g, { now: NOW, modo: "agradecimento" });
    expect(sentTexts[0].text).toContain(GOOGLE);
    expect(sentTexts[0].text).toContain("Thaise");
    await sendViradaTest("depois", PHONE, g, { now: NOW, modo: "pesquisa" });
    expect(sentPolls).toEqual([{ to: PHONE, title: expect.stringContaining("Thaise"), options: [...SATISFACTION_OPTIONS] }]);
    expect(await db.select().from(satisfactionAnswers)).toHaveLength(0);
    expect((await testes("depois")).map((t) => (t.data as { modo?: string }).modo)).toEqual(["agradecimento", "pesquisa"]);
  });
});
