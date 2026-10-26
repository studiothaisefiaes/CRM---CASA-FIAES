import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../db";
import { aiSuggestions, contacts, deals, lists, messages, outbox, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { eq } from "drizzle-orm";
import { recordInbound, recordOutbound } from "../domain/deals";
import { generateProgramada, programadaAvailable } from "./programada";
import { aiSpend, saveAiSettings } from "./settings";
import { AiError } from "./client";
import { suggestionState, type Caller } from "./suggest";

/** "Escrever com IA" na mensagem programada: o caller é falso (nunca a Anthropic) e nada é programado nem enviado. */
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00 em Salvador
const plus = (s: number) => new Date(T0.getTime() + s * 1000);
const SEND = new Date("2026-10-22T18:30:00Z"); // quinta 15:30 em Salvador
const usage = { inputTokens: 700, cachedTokens: 3000, cacheWriteTokens: 0, outputTokens: 80 };
let calls: { system: string; user: string }[] = [];
const caller = (sugestao = "Oi, Paula! Tudo bem? Ficou alguma dúvida do orçamento?"): Caller => async (input) => {
  calls.push(input); return { data: { resumo: "dúvida do orçamento", sugestao, precisa_humano: false, motivo: "" }, usage, costMicros: 150, model: "claude-haiku-5-5" };
};
let dealId = "", deal2 = "", sara = "";
const ligar = (extra: Partial<{ enabled: boolean; monthlyLimitUsd: number; dailyCalls: number }> = {}) => saveAiSettings({ enabled: true, monthlyLimitUsd: 40, dailyCalls: 1500, ...extra }, sara);
const gerar = (o: Partial<Parameters<typeof generateProgramada>[0]> = {}) =>
  generateProgramada({ dealIds: [dealId], tema: "perguntar se ficou alguma dúvida do orçamento", sendAt: SEND, now: plus(120), userId: sara, caller: caller(), ...o });

beforeEach(async () => {
  await resetDb();
  calls = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-teste-falsa");
  vi.stubEnv("AI_MODEL", "");
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1/messages");
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const r = await recordInbound({ channelId: null, externalId: "P1", phoneRaw: "71999990072", pushName: "PAULA souza", body: "Me manda o orçamento da progressiva? meu email é paula@x.com", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
  await recordOutbound({ dealId, channelId: null, body: "*SARA - CASA FIAES:*\nOi, Paula! A progressiva fica R$ 300. Quer marcar?", userId: sara, at: plus(30) });
  const r2 = await recordInbound({ channelId: null, externalId: "P2", phoneRaw: "71999990073", pushName: "Bia", body: "Oi", at: T0, now: T0 });
  if (!("dealId" in r2)) throw new Error("sem conversa 2");
  deal2 = r2.dealId;
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("mensagem programada escrita pela IA", () => {
  it("monta o pedido com o tema, a conversa enxuta e o dia/hora do envio; devolve só o texto e não programa nem envia nada", async () => {
    await ligar();
    const outBefore = (await db.select().from(messages)).length, tasksBefore = (await db.select().from(tasks)).length;
    const r = await gerar({ tema: "perguntar se ficou alguma dúvida do orçamento, cpf 123.456.789-09" });
    expect(r).toEqual({ status: "gerada", texto: "Oi, Paula! Tudo bem? Ficou alguma dúvida do orçamento?", costMicros: 150 });
    const u = calls[0].user;
    expect(u).toContain("Tema (pedido da atendente; é o assunto, não o texto pronto): perguntar se ficou alguma dúvida do orçamento, cpf [CPF]");
    expect(u).toMatch(/A mensagem sai: qui\.?, 22\/10, 15:30/);
    expect(u).toContain("Agora: terça, 20/10/2026, 10:02 (Salvador).");
    expect(u).toContain("Cliente: Paula.");
    expect(u).toContain("Casa: Oi, Paula! A progressiva fica R$ 300. Quer marcar?");
    expect(u).not.toMatch(/paula@x\.com|71999990072|souza|123\.456/i);
    // Mesmo bloco fixo da sugestão (mesmo cache).
    expect(calls[0].system).toContain("# Skill: atendimento da Casa Fiaes no WhatsApp");
    // Nada programado, nenhum lembrete, nenhuma mensagem nova; e não vira "sugestão de resposta" da conversa.
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect((await db.select().from(tasks)).length).toBe(tasksBefore);
    expect((await db.select().from(messages)).length).toBe(outBefore);
    expect((await suggestionState(dealId, plus(200))).state).not.toBe("pronta");
  });

  it("grava o uso como 'programada' (sem conversa ligada) e entra no gasto do mês", async () => {
    await ligar();
    await gerar();
    const [row] = await db.select().from(aiSuggestions);
    expect(row).toMatchObject({ origin: "programada", dealId: null, lastMessageId: null, requestedBy: sara, inputTokens: 700, cachedTokens: 3000, outputTokens: 80, costUsdMicros: 150 });
    expect(await aiSpend(plus(200))).toMatchObject({ monthMicros: 150, monthCalls: 1, todayCalls: 1 });
  });

  it("'Gerar de novo' manda o texto anterior para não repetir", async () => {
    await ligar();
    await gerar({ anterior: "Oi, Paula! Ficou alguma dúvida?" });
    expect(calls[0].user).toContain("Escreva uma versão diferente desta:\n- Oi, Paula! Ficou alguma dúvida?");
  });

  it("lote: UM modelo com {primeiro_nome}, sem ler nenhuma conversa", async () => {
    await ligar();
    const r = await gerar({ dealIds: [dealId, deal2], caller: caller("Oi, {primeiro_nome}! Ficou alguma dúvida?") });
    expect(r).toMatchObject({ status: "gerada", texto: "Oi, {primeiro_nome}! Ficou alguma dúvida?" });
    expect(calls).toHaveLength(1);
    const u = calls[0].user;
    expect(u).toContain("No lugar do nome use exatamente {primeiro_nome}");
    expect(u).toMatch(/A mensagem sai: qui\.?, 22\/10, 15:30/);
    expect(u).not.toMatch(/<conversa>|Paula|Bia|progressiva/);
  });

  it("desligada: não aparece e não chama", async () => {
    expect(await programadaAvailable()).toBe(false);
    expect(await gerar()).toEqual({ status: "pulada", motivo: "desligada" });
    await ligar();
    expect(await programadaAvailable()).toBe(true);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await programadaAvailable()).toBe(false);
    expect(await gerar()).toEqual({ status: "pulada", motivo: "sem_chave" });
    expect(calls).toHaveLength(0);
  });

  it("respeita o teto do mês e o do dia", async () => {
    await ligar({ monthlyLimitUsd: 1 });
    await db.insert(aiSuggestions).values({ origin: "programada", resumo: "", sugestao: "x", model: "m", costUsdMicros: 1_000_000, createdAt: plus(-60) });
    expect(await gerar()).toEqual({ status: "pulada", motivo: "teto_mes" });
    await db.delete(aiSuggestions);
    await ligar({ dailyCalls: 10 });
    await db.insert(aiSuggestions).values(Array.from({ length: 10 }, () => ({ origin: "programada" as const, resumo: "", sugestao: "x", model: "m", createdAt: plus(-60) })));
    expect(await gerar()).toEqual({ status: "pulada", motivo: "teto_dia" });
    expect(calls).toHaveLength(0);
  });

  it("tema vazio não chama; falha cobrada entra no gasto, falha não cobrada não grava nada", async () => {
    await ligar();
    expect(await gerar({ tema: "  " })).toEqual({ status: "pulada", motivo: "sem_tema" });
    const cobrada: Caller = async () => { throw new AiError("formato", "fora", 200, usage); };
    expect((await gerar({ caller: cobrada })).status).toBe("falhou");
    const [row] = await db.select().from(aiSuggestions);
    expect(row).toMatchObject({ origin: "programada", motivo: "falhou: ilegivel", sugestao: "" }); // fora do formato 2 vezes
    expect(row.costUsdMicros).toBeGreaterThan(0);
    const rede: Caller = async () => { throw new AiError("rede", "sem rede"); };
    expect((await gerar({ caller: rede })).status).toBe("falhou");
    expect(await db.select().from(aiSuggestions)).toHaveLength(1);
  });
});

describe("Escrever com IA: pós-processamento", () => {
  it("devolve o texto corrigido e pede de novo se vier embaralhado", async () => {
    await ligar();
    expect(await gerar({ caller: caller("Oi, Paula! A Thaise volta dia 07/10 e te retorno ainda hoje.") })).toMatchObject({ status: "gerada", texto: "Oi, Paula! Thaise volta dia 07/10, vou ver isso para você." });
    calls = [];
    let n = 0;
    const r = await gerar({ caller: async (input) => { calls.push(input); return { data: { resumo: "x", sugestao: n++ ? "Oi, Paula! Ficou alguma dúvida?" : "casa casa casa casa casa", precisa_humano: false, motivo: "" }, usage, costMicros: 150, model: "m" }; } });
    expect(r).toMatchObject({ status: "gerada", texto: "Oi, Paula! Ficou alguma dúvida?" });
    expect(calls).toHaveLength(2);
  });

  it("cliente que disse Não à IA: não lê a conversa, não chama a IA e devolve o motivo", async () => {
    await ligar();
    const [d] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
    await db.update(contacts).set({ consentAi: false }).where(eq(contacts.id, d.contactId));
    expect(await gerar()).toEqual({ status: "pulada", motivo: "sem_consentimento_ia" });
    expect(calls).toHaveLength(0);
    expect(await db.select().from(aiSuggestions)).toHaveLength(0);
  });
});

describe("material da resposta pronta (vídeo do Método Fiaes, 24/10) não entra na mensagem programada", () => {
  it("a lista de materiais não vai para a IA (a programada sai só como texto) e uma marca que venha mesmo assim não vaza", async () => {
    await ligar();
    await db.insert(lists).values({ kind: "quick_reply", label: "metodo-fiaes", body: "O Método Fiaes® é exclusivo da Casa.",
      meta: { attachment: { path: "resposta-x.mp4", mime: "video/mp4", name: "metodo.mp4", kind: "video" }, iaQuando: "a cliente perguntar sobre o Método Fiaes" } });
    const r = await gerar({ caller: caller("Oi, Paula! Quer conhecer o Método Fiaes®?\n[[material:/metodo-fiaes]]") });
    expect(calls[0].system).not.toContain("Materiais para enviar");
    expect(calls[0].system).not.toContain("[[material:");
    expect(r).toMatchObject({ status: "gerada", texto: "Oi, Paula! Quer conhecer o Método Fiaes®?" });
  });
});
