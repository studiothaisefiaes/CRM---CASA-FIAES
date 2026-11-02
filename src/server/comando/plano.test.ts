import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiSuggestions, appointments, settings } from "../db/schema";
import { resetDb } from "../../../test/db";
import { bahia, cliente, NOW, setupAgenda } from "../../../test/agenda-fixtures";
import { executar, montarPlano, planejar, catalogo } from "./plano";
import { buildPrompt, type Interpretacao } from "./interpretar";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const base: Interpretacao = { acao: "marcar", cliente: null, telefone: null, servico_id: null, profissional_id: null, data: null, hora: null, hora_fim: null, texto: null, duvida: null };

describe("comando de voz", () => {
  it("marcar: monta o cartão com a cliente, serviço, profissional e duração e só marca no executar", async () => {
    const p = await cliente("Paula Souza");
    const i = { ...base, cliente: "paula souza", servico_id: s.corte.id, profissional_id: s.ana.id, data: "2026-10-16", hora: "10:00", hora_fim: "11:30" };
    const plano = await montarPlano(i, "marca a paula", await catalogo(), NOW);
    expect(plano).toMatchObject({ acao: "marcar", servico: "Corte", duracaoMin: 90, faltando: [] });
    expect(plano.candidatas.map((c) => c.contactId)).toEqual([p.contactId]);
    expect(await db.select().from(appointments)).toHaveLength(0);
    const r = await executar(plano, p.contactId, s.recepcao, NOW);
    expect(r.mensagem).toContain("Marcado");
    const [a] = await db.select().from(appointments);
    expect(a).toMatchObject({ contactId: p.contactId, professionalId: s.ana.id, durationMin: 90 });
    expect(a.startsAt.toISOString()).toBe(bahia(16, 10).toISOString());
  });

  it("falta serviço e hora: não deixa confirmar; cliente que não existe também", async () => {
    await cliente("Paula Souza");
    const plano = await montarPlano({ ...base, cliente: "Paula" }, "marca a paula", await catalogo(), NOW);
    expect(plano.faltando).toEqual(expect.arrayContaining(["Qual serviço?", "Com qual profissional?", "Que dia e hora?"]));
    const nada = await montarPlano({ ...base, acao: "nota", cliente: "Fulana Inexistente", texto: "x" }, "x", await catalogo(), NOW);
    expect(nada.faltando[0]).toContain("Não achei");
  });

  it("cancelar: acha o próximo horário e cancela; sem permissão recusa", async () => {
    const p = await cliente("Paula Souza");
    const plano1 = await montarPlano({ ...base, cliente: "Paula", servico_id: s.corte.id, profissional_id: s.ana.id, data: "2026-10-16", hora: "10:00" }, "x", await catalogo(), NOW);
    await executar(plano1, p.contactId, s.recepcao, NOW);
    const plano = await montarPlano({ ...base, acao: "cancelar", cliente: "Paula Souza" }, "cancela a paula", await catalogo(), NOW);
    expect(plano.horarios[p.contactId]?.label).toContain("Corte");
    await expect(executar(plano, p.contactId, { id: s.cati.id, perms: ["atendimento.ver"] }, NOW)).rejects.toThrow("permissão");
    await executar(plano, p.contactId, s.recepcao, NOW);
    expect((await db.select().from(appointments))[0].status).toBe("cancelado");
  });

  it("interpreta pela IA (falsa), registra o custo e o prompt leva a data de hoje e as listas", async () => {
    await db.insert(settings).values({ key: "ia_sugestao", value: { enabled: true, monthlyLimitUsd: 40, dailyCalls: 100 } });
    process.env.ANTHROPIC_API_KEY = "sk-falsa";
    const p = await cliente("Paula Souza");
    const resp = { ...base, cliente: "Paula", servico_id: s.corte.id, profissional_id: s.ana.id, data: "2026-10-16", hora: "10:00" };
    const plano = await planejar("marca a paula sexta 10h corte com a ana", s.cati.id, NOW, async () => ({ text: JSON.stringify(resp), model: "claude-haiku-5-5", usage: { inputTokens: 10, cachedTokens: 0, cacheWriteTokens: 0, outputTokens: 5 } }));
    delete process.env.ANTHROPIC_API_KEY;
    expect(plano.candidatas[0].contactId).toBe(p.contactId);
    expect(await db.select().from(aiSuggestions).where(eq(aiSuggestions.origin, "comando"))).toHaveLength(1);
    const pr = buildPrompt("x", await catalogo(), NOW);
    expect(pr.user).toContain("2026-10-15 (quinta)");
    expect(pr.system).toContain(s.corte.id);
  });
});
