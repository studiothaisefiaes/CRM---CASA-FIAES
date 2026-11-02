import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { aiLicoes, aiSuggestions, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "../domain/deals";
import { saveAiSettings } from "./settings";
import { licoesDasEdicoes, paresDoDia, promptLicoes } from "./licoes-edicoes";

// 20h de Salvador.
const NOW = new Date("2026-11-03T23:00:00Z");
const at = (min: number) => new Date(NOW.getTime() - 5 * 3_600_000 + min * 60_000);
let sara = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  await saveAiSettings({ enabled: true, monthlyLimitUsd: 40, dailyCalls: 1500 }, sara);
  process.env.ANTHROPIC_API_KEY = "sk-falsa";
  for (let i = 0; i < 5; i++) {
    const r = await recordInbound({ channelId: null, externalId: `I${i}`, phoneRaw: `7199999008${i}`, pushName: `Cliente ${i}`, body: "Muito obrigada! Bom fim de semana", at: at(i * 10), now: at(i * 10) });
    if (!("dealId" in r)) throw new Error("sem lead");
    const [m] = await db.execute<{ id: string }>(`select id from messages where deal_id = '${r.dealId}' order by created_at desc limit 1` as never).then((x) => x.rows);
    await db.insert(aiSuggestions).values({ dealId: r.dealId, lastMessageId: m.id, resumo: "", sugestao: "Imagina, querida! Tenha um ótimo fim de semana. Tenho sábado às 9h com Thaise Fiaes, posso reservar pra você?", model: "x", createdAt: at(i * 10 + 1), usedAt: at(i * 10 + 2) });
    await recordOutbound({ dealId: r.dealId, channelId: null, body: "*SARA - CASA FIAES:*\nImagina! Até logo 🥰", userId: sara, at: at(i * 10 + 3) });
  }
});

describe("lições das edições", () => {
  it("acha os pares editados e o prompt leva o que a IA disse e o que a equipe mandou", async () => {
    const p = await paresDoDia(new Date(NOW.getTime() - 86_400_000), NOW);
    expect(p).toHaveLength(5);
    expect(p[0].equipe).toBe("Imagina! Até logo 🥰");
    expect(promptLicoes(p, ["Seja breve."]).user).toContain("Equipe enviou: Imagina! Até logo");
  });
  it("uma vez por dia, só depois das 19h; as lições nascem pendentes", async () => {
    const caller = async () => ({ text: JSON.stringify({ licoes: ["Na despedida, responda com uma frase curta e não ofereça horário."] }), model: "claude-sonnet-5-5", usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 1 } });
    expect(await licoesDasEdicoes(new Date("2026-11-03T20:00:00Z"), caller)).toBe(0); // 17h
    expect(await licoesDasEdicoes(NOW, caller)).toBe(1);
    expect(await licoesDasEdicoes(NOW, caller)).toBe(0);
    const [l] = await db.select().from(aiLicoes);
    expect(l).toMatchObject({ status: "pendente", licao: "Na despedida, responda com uma frase curta e não ofereça horário." });
    delete process.env.ANTHROPIC_API_KEY;
  });
});
