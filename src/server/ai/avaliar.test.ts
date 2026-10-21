import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiSuggestions, lists, outbox, professionals, professionalServices, settings, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "../domain/deals";
import { avaliar } from "./avaliar";
import type { Caller } from "./suggest";

/**
 * O modo de avaliação (scripts/ai-avaliar.ts): conversas FICTÍCIAS num banco de teste e a IA FALSA (nunca a Anthropic).
 * Nada é gravado em ai_suggestions nem enviado.
 */
const allDay = ["06:00", "22:00"];
let calls: string[] = [];
const fake: Caller = async (input) => {
  calls.push(input.user);
  const h = /(\d{1,2}h\d{0,2}) \(h1\)/.exec(input.user)?.[1];
  const sugestao = h ? `Tenho ${h} com a Thaise. Posso reservar pra você?` : "A escova é R$ 80. Quer que eu veja um horário?";
  return { data: { resumo: "Quer horário.", sugestao, precisa_humano: false, motivo: "", horario: h ? "h1" : "" }, usage: { inputTokens: 800, cachedTokens: 3000, cacheWriteTokens: 0, outputTokens: 50 }, costMicros: 200, model: "fake" };
};

beforeEach(async () => {
  await resetDb();
  calls = [];
  await db.insert(settings).values({ key: "business_hours", value: Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, allDay])) });
  const [corte] = await db.update(lists).set({ durationMin: 60, priceCents: 9000 }).where(eq(lists.label, "Corte")).returning();
  const [p] = await db.insert(professionals).values({ name: "THAISE FIAES" }).returning();
  await db.insert(professionalServices).values({ professionalId: p.id, serviceId: corte.id });
  const [sara] = await db.insert(users).values({ name: "Sara", email: "sara@t.local", role: "atendente", passwordHash: "x" }).returning();
  const t = (min: number) => new Date(Date.now() - (90 - min) * 60_000);
  // Ana pede horário (sem resposta ainda); Bia pergunta preço e a Casa respondeu.
  await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71999880001", pushName: "Ana Souza", body: "Oi! Tem horário amanhã pra corte?", at: t(0), now: t(0) });
  const b = await recordInbound({ channelId: null, externalId: "E2", phoneRaw: "71999880002", pushName: "Bia Lima", body: "Quanto custa a escova? meu cel 71 98888-7777", at: t(5), now: t(5) });
  await recordOutbound({ dealId: (b as { dealId: string }).dealId, channelId: null, body: "*SARA - CASA FIAES:*\nOi, Bia! A escova é R$ 80 😊", userId: sara.id, at: t(8) });
});

describe("avaliação da sugestão (scripts/ai-avaliar.ts)", () => {
  it("--so-horario: só pedidos de horário, lado a lado pedido → sugestão → horário proposto; nada gravado nem enviado", async () => {
    const r = await avaliar({ n: 20, dias: 30, soHorario: true, apiKey: "sk-falsa", model: "fake", caller: fake });
    expect(calls).toHaveLength(1);
    expect(r.markdown).toContain("# Avaliação da sugestão de resposta por IA · só pedidos de horário");
    expect(r.markdown).toContain("> Oi! Tem horário amanhã pra corte?");
    expect(r.markdown).toMatch(/\*\*Horários que a IA recebeu:\*\* `Horários livres \(Corte, 1 h\) para .*Thaise \d{1,2}h\d{0,2} \(h1\)/);
    expect(r.markdown).toMatch(/\*\*Horário proposto:\*\* .* às \d{1,2}h\d{0,2} · Thaise Fiaes · Corte \(h1\)/);
    expect(r.markdown).toContain("_(ainda sem resposta da Casa)_");
    expect(r.markdown).not.toContain("escova");
    expect(r.totals).toMatchObject({ conversas: 1, comOpcoes: 1, comHorario: 1, vouVerificar: 0 });
    expect(await db.select().from(aiSuggestions)).toHaveLength(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
  it("padrão: a resposta real da equipe ao lado; telefone vira marcador; 'vou verificar' com horários vira alerta", async () => {
    const r = await avaliar({ n: 20, dias: 30, apiKey: "sk-falsa", model: "fake", caller: fake });
    expect(r.markdown).toContain("> Oi, Bia! A escova é R$ 80 😊");
    expect(r.markdown).not.toMatch(/98888|7777/);
    const v = await avaliar({ n: 20, dias: 30, soHorario: true, apiKey: "sk-falsa", model: "fake",
      caller: async () => ({ data: { resumo: "", sugestao: "Vou verificar a agenda e já te retorno!", precisa_humano: false, motivo: "", horario: "" }, usage: { inputTokens: 1, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 1 }, costMicros: 1, model: "fake" }) });
    // ia-horarios2: o "vou verificar" cru conta e aparece; o servidor troca pela proposta (o que a tela mostra), com o horário proposto.
    expect(v.markdown).toContain("**Atenção:** a IA disse \"vou verificar\" com horários livres na mão; o servidor trocou pela proposta");
    expect(v.totals).toMatchObject({ vouVerificarCru: 1, vouVerificar: 0, garantidas: 1, comHorario: 1 });
    expect(v.markdown).toMatch(/> Tenho [a-zçá]+, \d{2}\/\d{2}, às \d{1,2}h\d{0,2} com nossa Diretora Técnica, Thaise Fiaes\. Posso reservar pra você\?/);
    expect(v.markdown).toContain("garantidas pelo servidor: 1");
    expect(await db.select().from(aiSuggestions)).toHaveLength(0);
  });
});

describe("avaliação igual à tela (IA v3)", () => {
  it("padrão: pedido de horário respondido pela Casa leva a linha de horários livres; texto pós-processado com o cru ao lado; --manual troca o manual", async () => {
    const t = (min: number) => new Date(Date.now() - (60 - min) * 60_000);
    const [sara] = await db.select().from(users);
    const c = await recordInbound({ channelId: null, externalId: "E3", phoneRaw: "71999880003", pushName: "Carla", body: "Tem horário amanhã pra corte?", at: t(0), now: t(0) });
    await recordOutbound({ dealId: (c as { dealId: string }).dealId, channelId: null, body: "*SARA - CASA FIAES:*\nTem sim! 10h?", userId: sara.id, at: t(5) });
    const systems: string[] = [];
    const r = await avaliar({ n: 20, dias: 30, apiKey: "sk-falsa", model: "fake", manual: { cenarios: "CENARIO-DO-ARQUIVO" }, caller: async (input) => { systems.push(input.system); return fake(input, { apiKey: "", model: "" }); } });
    expect(r.markdown).toMatch(/\*\*Horários que a IA recebeu:\*\* `Horários livres \(Corte, 1 h\)/);
    expect(r.markdown).toMatch(/> Tenho \d{1,2}h\d{0,2} com Thaise\. Posso reservar pra você\?/);
    expect(r.markdown).toContain("**Texto cru da IA (antes do pós-processamento):**");
    expect(r.markdown).toContain("Manual da Casa: o do arquivo");
    expect(r.totals.posProcessadas).toBeGreaterThanOrEqual(1);
    expect(systems.every((s) => s.includes("## Cenários\nCENARIO-DO-ARQUIVO"))).toBe(true);
    // A conversa da Bia (preço) não pede horário: sem a linha.
    expect(r.markdown.split("## ").find((x) => x.includes("Bia"))).not.toContain("Horários que a IA recebeu");
    expect(await db.select().from(aiSuggestions)).toHaveLength(0);
  });
});
