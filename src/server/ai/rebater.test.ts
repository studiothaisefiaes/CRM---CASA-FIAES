import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiLicoes, aiSuggestions, lists, messages, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { generateForDeal, type Caller } from "./suggest";
import { saveAiSettings } from "./settings";
import { approvedLicoes, decideLicao, listLicoes } from "./licoes";

// Rebater (29/10, pedido do dono): a atendente diz o que não gostou, a IA refaz e diz o que errou. A lição só vale depois da gestão aprovar.
const T0 = new Date("2026-10-20T13:00:00Z");
const plus = (s: number) => new Date(T0.getTime() + s * 1000);
const usage = { inputTokens: 900, cachedTokens: 3000, cacheWriteTokens: 0, outputTokens: 120 };
const base = { resumo: "Quer saber o preço.", precisa_humano: false, motivo: "" };
let calls: { system: string; user: string }[] = [];
const caller = (sugestao: string, licao = ""): Caller => async (input) => { calls.push(input); return { data: { ...base, sugestao, licao }, usage, costMicros: 10, model: "claude-sonnet-5-5" }; };
let dealId = "", sara = "";

beforeEach(async () => {
  await resetDb();
  calls = [];
  vi.stubEnv("ANTHROPIC_API_KEY", "sk-teste-falsa");
  vi.stubEnv("AI_BASE_URL", "http://127.0.0.1:9/v1/messages");
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  await db.update(lists).set({ priceCents: 8000, category: "Cabelo", durationMin: 45 }).where(eq(lists.kind, "service"));
  const r = await recordInbound({ channelId: null, externalId: "A1", phoneRaw: "71999990071", pushName: "Paula Souza", body: "Quanto custa a escova?", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
  await saveAiSettings({ enabled: true, monthlyLimitUsd: 40, dailyCalls: 1500 }, sara);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("Rebater a sugestão", () => {
  it("refaz com a crítica e a sugestão anterior; o que errou vira lição PENDENTE e não entra na IA até a gestão aprovar", async () => {
    await generateForDeal(dealId, { now: plus(10), userId: sara, caller: caller("Paula, a escova fica R$ 80. Quer marcar para amanhã às 10h?") });
    const r = await generateForDeal(dealId, { origin: "outra", userId: sara, critica: "não ofereça horário, ela só perguntou o preço", now: plus(20),
      caller: caller("Paula, a escova fica R$ 80. 😊", "Não oferecer horário quando a cliente só perguntou o preço.") });
    expect(r.status).toBe("gerada");
    expect(calls[1].user).toContain("<rebatida>");
    expect(calls[1].user).toContain("Quer marcar para amanhã às 10h?");
    expect(calls[1].user).toContain("não ofereça horário, ela só perguntou o preço");
    expect(calls[1].user).not.toContain("Escreva uma versão diferente destas");
    const nova = (await db.select().from(aiSuggestions)).find((s) => s.critica);
    expect(nova).toMatchObject({ origin: "outra", critica: "não ofereça horário, ela só perguntou o preço", sugestao: "Paula, a escova fica R$ 80. 😊" });
    expect(await listLicoes()).toEqual([expect.objectContaining({ status: "pendente", licao: "Não oferecer horário quando a cliente só perguntou o preço.", quem: "Sara Lima" })]);
    expect(await approvedLicoes()).toEqual([]);
    expect(calls[1].system).not.toContain("Lições aprendidas");
    // nada foi enviado
    expect((await db.select().from(messages)).filter((m) => m.direction === "out")).toHaveLength(0);
  });

  it("aprovada (com o texto ajustado), entra no bloco fixo de toda sugestão; tirar some de novo", async () => {
    await generateForDeal(dealId, { now: plus(10), userId: sara, caller: caller("A") });
    await generateForDeal(dealId, { origin: "outra", userId: sara, critica: "mais curta", now: plus(20), caller: caller("B", "Ser mais curta.") });
    const [l] = await db.select().from(aiLicoes);
    await decideLicao(l.id, "aprovada", sara, "Respostas curtas: no máximo 2 frases.");
    await generateForDeal(dealId, { origin: "outra", userId: sara, now: plus(30), caller: caller("C") });
    expect(calls.at(-1)!.system).toContain("## Lições aprendidas");
    expect(calls.at(-1)!.system).toContain("- Respostas curtas: no máximo 2 frases.");
    await decideLicao(l.id, "descartada", sara);
    await generateForDeal(dealId, { origin: "outra", userId: sara, now: plus(40), caller: caller("D") });
    expect(calls.at(-1)!.system).not.toContain("Lições aprendidas");
  });

  it("sem lição (vazia) não grava nada; Outra comum continua pedindo versão diferente", async () => {
    await generateForDeal(dealId, { now: plus(10), userId: sara, caller: caller("A") });
    await generateForDeal(dealId, { origin: "outra", userId: sara, now: plus(20), caller: caller("B") });
    expect(calls[1].user).toContain("Escreva uma versão diferente destas");
    expect(await db.select().from(aiLicoes)).toHaveLength(0);
  });
});
