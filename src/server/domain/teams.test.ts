import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, auditLog, dealEvents, deals, settings, teams, users } from "../db/schema";
import { recordInbound } from "./deals";
import { listTeams, passToTeam, saveTeam } from "./teams";
import { saveFuncao } from "./funcoes";
import { teamsForPass } from "../queries/deal";
import { resetDb } from "../../../test/db";

const NOW = new Date("2026-10-19T15:00:00Z");
const seen = new Date(NOW.getTime() - 60_000);
const teamId = async (name: string) => (await db.select().from(teams).where(eq(teams.name, name)))[0].id;

describe("setores", () => {
  let sara: typeof users.$inferSelect, cati: typeof users.$inferSelect, dealId: string, uid: string;
  const mk = (name: string, extra: Partial<typeof users.$inferInsert> = {}) =>
    db.insert(users).values({ name, email: `${name}@c.com`, role: "atendente", passwordHash: "x", availability: "disponivel", lastSeenAt: seen, ...extra }).returning().then((r) => r[0]);
  const newDeal = async (n: string) => {
    const r = await recordInbound({ channelId: null, externalId: n, phoneRaw: `7199850${n.padStart(4, "0")}`, pushName: "Fulana", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    return r.dealId;
  };
  beforeEach(async () => {
    await resetDb();
    sara = await mk("Sara"); cati = await mk("Cati"); uid = sara.id;
    dealId = await newDeal("1");
  });

  it("0070 cria os três setores da Casa vazios", async () => {
    expect((await listTeams()).map((t) => t.name)).toEqual(["Recepção", "Método Fiaes®", "Serviços gerais"]);
    expect((await listTeams()).every((t) => t.members.length === 0)).toBe(true);
  });

  it("passa para a pessoa do setor Disponível, com sinal, e com menos conversas esperando", async () => {
    const rec = await teamId("Recepção");
    await saveTeam({ id: rec, name: "Recepção", memberIds: [sara.id, cati.id] }, uid);
    for (const n of ["2", "3"]) { const d = await newDeal(n); await db.update(deals).set({ ownerId: sara.id }).where(eq(deals.id, d)); }
    const r = await passToTeam(dealId, rec, null, NOW);
    expect(r.ownerId).toBe(cati.id);
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(d.teamId).toBe(rec); expect(d.ownerId).toBe(cati.id);
    const ev = await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "passado_para_setor")));
    expect(ev).toHaveLength(1);
  });

  it("ninguém livre no setor: sem dona, marcada no setor, e avisa a gestão no sino", async () => {
    const metodo = await teamId("Método Fiaes®");
    const r = await passToTeam(dealId, metodo, null, NOW);
    expect(r.ownerId).toBeNull();
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(d.teamId).toBe(metodo); expect(d.ownerId).toBeNull();
    const al = await db.select().from(alerts).where(and(eq(alerts.dealId, dealId), eq(alerts.type, "setor_sem_ninguem")));
    expect(al).toHaveLength(1);
    expect(al[0].audience).toBe("gestao");
    expect(al[0].message).toBe("Ninguém livre no setor Método Fiaes® para atender Fulana.");
  });

  it("mudar o texto do aviso muda a mensagem do alerta", async () => {
    await saveFuncao("setores", { textos: { sem_ninguem: "Setor {setor} vazio: {nome} espera." } }, uid);
    await passToTeam(dealId, await teamId("Método Fiaes®"), null, NOW);
    const [al] = await db.select().from(alerts).where(eq(alerts.type, "setor_sem_ninguem"));
    expect(al.message).toBe("Setor Método Fiaes® vazio: Fulana espera.");
  });

  it("quem está em Pausa ou sem sinal há mais de 5 min não recebe", async () => {
    const rec = await teamId("Recepção");
    await saveTeam({ id: rec, name: "Recepção", memberIds: [sara.id, cati.id] }, uid);
    await db.update(users).set({ availability: "pausa" }).where(eq(users.id, sara.id));
    await db.update(users).set({ lastSeenAt: new Date(NOW.getTime() - 6 * 60_000) }).where(eq(users.id, cati.id));
    expect((await passToTeam(dealId, rec, null, NOW)).ownerId).toBeNull();
  });

  it("não exige a permissão de receber distribuição (Thaise está no Método Fiaes® sem ela)", async () => {
    const metodo = await teamId("Método Fiaes®");
    await saveTeam({ id: metodo, name: "Método Fiaes®", memberIds: [sara.id] }, uid);
    expect((await passToTeam(dealId, metodo, null, NOW)).ownerId).toBe(sara.id);
  });

  it("setor desativado não recebe", async () => {
    const rec = await teamId("Recepção");
    await saveTeam({ id: rec, name: "Recepção", active: false, memberIds: [sara.id] }, uid);
    await expect(passToTeam(dealId, rec, null, NOW)).rejects.toThrow("Esse setor está desativado.");
  });

  it("nome repetido (sem acento e maiúsculas) é recusado", async () => {
    await expect(saveTeam({ name: "recepcao", memberIds: [] }, uid)).rejects.toThrow("Já existe o setor Recepção.");
    await expect(saveTeam({ id: await teamId("Serviços gerais"), name: "RECEPÇÃO", memberIds: [] }, uid)).rejects.toThrow("Já existe o setor Recepção.");
  });

  it("cria setor novo e troca os membros", async () => {
    const { id } = await saveTeam({ name: "Maquiagem", memberIds: [sara.id] }, uid);
    expect((await listTeams()).find((t) => t.id === id)?.members.map((m) => m.name)).toEqual(["Sara"]);
    await saveTeam({ id, name: "Maquiagem", memberIds: [cati.id] }, uid);
    expect((await listTeams()).find((t) => t.id === id)?.members.map((m) => m.name)).toEqual(["Cati"]);
  });

  it("com a função Setores desligada, passToTeam recusa", async () => {
    await saveFuncao("setores", { on: false }, uid);
    await expect(passToTeam(dealId, await teamId("Recepção"), null, NOW)).rejects.toThrow("Setores está desligada em Configurações › Recursos.");
    expect((await db.select().from(settings).where(eq(settings.key, "funcoes"))).length).toBe(1);
  });

  it("a seção Setores do Passar para… lista os ativos e some com a função desligada", async () => {
    await saveTeam({ id: await teamId("Recepção"), name: "Recepção", memberIds: [sara.id] }, uid);
    await saveTeam({ id: await teamId("Serviços gerais"), name: "Serviços gerais", active: false, memberIds: [] }, uid);
    const on = await teamsForPass(NOW);
    expect(on.map((t) => t.name)).toEqual(["Recepção", "Método Fiaes®"]);
    expect(on[0].livres).toBe(1); // Sara: Disponível e com sinal
    await saveFuncao("setores", { on: false }, uid);
    expect(await teamsForPass(NOW)).toEqual([]);
  });

  it("conversa que já tinha dona e vai para setor sem ninguém livre: sem dona, evento, auditoria, oferta fechada e espera reatribuída", async () => {
    await db.update(deals).set({ ownerId: cati.id }).where(eq(deals.id, dealId));
    await db.insert(alerts).values([
      { dealId, userId: cati.id, audience: "responsavel", type: "oferta", message: "o", dedupeKey: "o1", waitKey: `oferta:${dealId}:1` },
      { dealId, userId: cati.id, audience: "responsavel", type: "sem_resposta_minutos", message: "e", dedupeKey: "e1", waitKey: `espera:${dealId}:1` },
    ]);
    const metodo = await teamId("Método Fiaes®");
    await passToTeam(dealId, metodo, uid, NOW);
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(d.ownerId).toBeNull(); expect(d.teamId).toBe(metodo);
    expect((await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "responsavel_alterado")))).length).toBe(1);
    expect((await db.select().from(auditLog).where(eq(auditLog.entityId, dealId))).length).toBeGreaterThan(0);
    const [oferta] = await db.select().from(alerts).where(eq(alerts.dedupeKey, "o1"));
    expect(oferta.resolvedAt).not.toBeNull();
    const [espera] = await db.select().from(alerts).where(eq(alerts.dedupeKey, "e1"));
    expect(espera.userId).toBeNull(); expect(espera.audience).toBe("gestao");
  });
});
