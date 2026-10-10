import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import { users } from "../db/schema";
import { recordInbound, recordOutbound, moveDeal, moveDealTx } from "../domain/deals";
import { toCsv, periodStart } from "./index";
import {
  periodWindow, firstResponse, funnelMilestones, staleNow, sourceToSale, lossesByReasonAndStage, financeWithPaid, dataQuality,
  crmVsPhone, followupEfficacy, demandHeatmap, personVsGoal, executiveNumbers, dailySummaryText,
} from "./index";
import { archiveDeals } from "../domain/archive";
import { deals, lists, leadSources, tasks, contacts, stages } from "../db/schema";
import { completeTaskTx } from "../domain/tasks";
import { eq, sql } from "drizzle-orm";
import { resetDb } from "../../../test/db";

describe("relatórios: utilidades", () => {
  it("CSV com BOM, ; e aspas", () => {
    expect(toCsv(["a", "b"], [["x;y", 2]])).toBe('﻿a;b\r\n"x;y";2');
  });

  it("início do período no fuso de Salvador", () => {
    expect(periodStart("hoje", new Date("2026-10-09T02:00:00Z")).toISOString()).toBe("2026-10-08T03:00:00.000Z");
    expect(periodStart("mes", new Date("2026-10-09T12:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});


// ---------------------------------------------------------------------------------------------
// T13a: consultas honestas (coorte, origem real, comparação). Relógio sempre explícito (`now`).
// ---------------------------------------------------------------------------------------------
const T = (h: number, m = 0, day = 13) => new Date(Date.UTC(2026, 9, day, h + 3, m)); // out/2026, hora local de Salvador (13/10 = terça)
const phone = (i: number) => `719${String(10_000_000 + i)}`;

async function lead(i: number, at: Date, body = "oi") {
  const r = await recordInbound({ channelId: null, externalId: `L${i}-${at.getTime()}`, phoneRaw: phone(i), body, at });
  if (!("dealId" in r)) throw new Error("lead não criado");
  return r.dealId;
}
async function sell(dealId: string, at: Date, valueCents: number, extra: Partial<typeof deals.$inferInsert> = {}) {
  await db.update(deals).set({ valueCents, paymentMethod: "pix", ...extra }).where(eq(deals.id, dealId));
  await db.transaction((tx) => moveDealTx(tx, dealId, "fechado", null, "venda", at));
}
async function mkUser(name: string, role: "gestor" | "atendente" = "atendente") {
  const [u] = await db.insert(users).values({ name, email: `${name.toLowerCase()}@c.com`, role, passwordHash: "x" }).returning();
  return u;
}

describe("relatórios honestos (T13a)", () => {
  beforeEach(async () => { await resetDb(); });

  it("janela do período: 'hoje' compara com ontem até a mesma hora", () => {
    const w = periodWindow({ period: "hoje", now: T(18) });
    expect(w.from.toISOString()).toBe(T(0).toISOString());
    expect(w.to.toISOString()).toBe(T(18).toISOString());
    expect(w.prevFrom.toISOString()).toBe(T(0, 0, 12).toISOString());
    expect(w.prevTo.toISOString()).toBe(T(18, 0, 12).toISOString());
    const m = periodWindow({ period: "mes", now: T(12, 0, 13) });
    expect(m.prevFrom.toISOString()).toBe(new Date("2026-09-01T03:00:00Z").toISOString());
    expect(m.prevTo.getTime() - m.prevFrom.getTime()).toBe(m.to.getTime() - m.from.getTime());
    const w7 = periodWindow({ period: "7d", now: T(18) });
    expect(w7.prevTo.getTime() - w7.prevFrom.getTime()).toBe(w7.to.getTime() - w7.from.getTime());
    expect(w7.prevTo.getTime()).toBeLessThanOrEqual(w7.from.getTime());
  });

  it("primeira resposta ignora as seguintes (35 min vs 3 min)", async () => {
    const r = await recordInbound({ channelId: null, externalId: "F1", phoneRaw: "71999994001", body: "oi", at: T(10) }); if (!("dealId" in r)) throw new Error();
    await recordOutbound({ dealId: r.dealId, channelId: null, body: "a", at: T(10, 35) });
    await recordInbound({ channelId: null, externalId: "F2", phoneRaw: "71999994001", body: "e o valor?", at: T(11) });
    await recordOutbound({ dealId: r.dealId, channelId: null, body: "b", at: T(11, 3) });
    const fr = await firstResponse({ period: "hoje", now: T(18) });
    expect(fr.n).toBe(1); expect(fr.p50).toBe(2100); expect(fr.bands.de10a60).toBe(1);
  });

  it("primeira resposta: sem amostra devolve null, faixas, prazo por etapa e período anterior", async () => {
    expect(await firstResponse({ period: "hoje", now: T(18) })).toMatchObject({ n: 0, p50: null, p90: null, slaHitPct: null, semResposta: 0 });
    // ontem: 1 lead respondido em 1 min (dentro da meta de 2 min)
    const y = await lead(1, T(9, 0, 12));
    await recordOutbound({ dealId: y, channelId: null, body: "a", at: T(9, 1, 12) });
    // hoje: um em 1 min, um em 5 min, um em 2h, um sem resposta
    const a = await lead(2, T(9)); await recordOutbound({ dealId: a, channelId: null, body: "a", at: T(9, 1) });
    const b = await lead(3, T(10)); await recordOutbound({ dealId: b, channelId: null, body: "a", at: T(10, 5) });
    const c = await lead(4, T(11)); await recordOutbound({ dealId: c, channelId: null, body: "a", at: T(13) });
    await lead(5, T(12));
    const fr = await firstResponse({ period: "hoje", now: T(18), compare: true });
    expect(fr).toMatchObject({ n: 3, semResposta: 1, bands: { ate2: 1, de2a10: 1, de10a60: 0, mais1h: 1 }, slaHitPct: 33 });
    expect(fr.p50).toBe(300);
    expect(fr.previous).toMatchObject({ n: 1, slaHitPct: 100, p50: 60 });
    expect(fr.byStage.find((s) => s.stage === "lead")).toMatchObject({ n: 3, slaSeconds: 120 });
  });

  it("conversão nunca passa de 100%: fechado de lead antigo não entra na coorte", async () => {
    const old = await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71999994002", body: "oi", at: new Date("2026-09-01T13:00:00Z") }); if (!("dealId" in old)) throw new Error();
    await db.transaction((tx) => moveDealTx(tx, old.dealId, "fechado", null, "manual", new Date("2026-09-02T13:00:00Z")));
    expect((await funnelMilestones({ period: "hoje", now: T(18) })).fechados).toBe(0);
    const set = await funnelMilestones({ period: "mes", now: new Date("2026-09-20T15:00:00Z") });
    expect(set).toMatchObject({ leads: 1, fechados: 1, perdidos: 0, emAberto: 0 });
    expect(set.conv.fechado).toBe(100);
  });

  it("funil por marcos: respondidos, agendados, fechados, perdidos e em aberto somam os leads", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push(await lead(10 + i, T(9, i)));
    await recordOutbound({ dealId: ids[0], channelId: null, body: "a", at: T(9, 10) });          // respondido
    await recordOutbound({ dealId: ids[1], channelId: null, body: "a", at: T(9, 11) });
    await moveDeal(ids[1], "agendado", null);                                                       // agendado
    await recordOutbound({ dealId: ids[2], channelId: null, body: "a", at: T(9, 12) });
    await moveDeal(ids[2], "agendado", null); await moveDeal(ids[2], "fechado", null);             // agendado + fechado
    await moveDeal(ids[3], "perdido", null);                                                        // perdido
    const m = await funnelMilestones({ period: "hoje", now: T(18), compare: true });              // ids[4] segue só em Lead
    expect(m).toMatchObject({ leads: 5, respondidos: 3, agendados: 2, fechados: 1, perdidos: 1, emAberto: 3 });
    expect(m.conv).toEqual({ respondido: 60, agendado: 40, fechado: 20 });
    expect(m.previous).toMatchObject({ leads: 0, conv: { respondido: null, agendado: null, fechado: null } });
  });

  it("WhatsApp vira 'Não identificada' e arquivado não conta", async () => {
    const a = await recordInbound({ channelId: null, externalId: "W1", phoneRaw: "71999994003", body: "oi", at: T(10) });
    const b = await recordInbound({ channelId: null, externalId: "W2", phoneRaw: "71999994004", body: "oi", at: T(10) });
    if (!("dealId" in a) || !("dealId" in b)) throw new Error();
    const [u] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    await archiveDeals([b.dealId], u.id);
    const rows = await sourceToSale({ period: "hoje", now: T(18) });
    expect(rows.find((x) => x.origem === "Não identificada")!.leads).toBe(1);
    expect(rows.some((x) => x.origem === "WhatsApp")).toBe(false);
  });

  it("origem até a venda: link rastreado, agendados, fechados e receita; 'Não identificada' sempre existe", async () => {
    const [src] = await db.insert(leadSources).values({ code: "bio12345", label: "Instagram bio", kind: "instagram" }).returning();
    const a = await lead(20, T(9), "oi #bio12345");
    await lead(21, T(9, 5), "oi #bio12345");
    await moveDeal(a, "agendado", null); await sell(a, T(15), 50_000);
    const rows = await sourceToSale({ period: "hoje", now: T(18) });
    expect(rows.find((r) => r.origem === src.label)).toMatchObject({ leads: 2, agendados: 1, fechados: 1, receitaCents: 50_000 });
    expect(rows.find((r) => r.origem === "Não identificada")).toMatchObject({ leads: 0, fechados: 0, receitaCents: 0 });
  });

  it("leads de histórico, arquivados e contatos ignorados ficam fora dos 'novos'", async () => {
    const h = await lead(30, T(9)); await lead(31, T(9, 5));
    await db.execute(sql`update deal_events set payload = jsonb_set(payload, '{historico}', 'true') where deal_id = ${h} and type = 'lead_criado'`);
    expect((await funnelMilestones({ period: "hoje", now: T(18) })).leads).toBe(1);
    const n = await executiveNumbers({ period: "hoje", now: T(18) });
    expect(n.leadsNovos.atual).toBe(1);
  });

  it("filtros de pessoa e de origem valem para a coorte", async () => {
    const ana = await mkUser("Ana");
    const [src] = await db.insert(leadSources).values({ code: "flyer123", label: "Panfleto", kind: "panfleto" }).returning();
    const a = await lead(35, T(9), "oi #flyer123"); const b = await lead(36, T(9, 5));
    await db.update(deals).set({ ownerId: ana.id }).where(eq(deals.id, a));
    await db.update(deals).set({ ownerId: null }).where(eq(deals.id, b));
    expect((await funnelMilestones({ period: "hoje", now: T(18), ownerId: ana.id })).leads).toBe(1);
    expect((await funnelMilestones({ period: "hoje", now: T(18), source: src.label })).leads).toBe(1);
    expect((await funnelMilestones({ period: "hoje", now: T(18), source: "Não identificada" })).leads).toBe(1);
    expect((await funnelMilestones({ period: "hoje", now: T(18) })).leads).toBe(2);
  });

  it("parados agora, por etapa: usa o limite de dias da etapa", async () => {
    await lead(40, T(9, 0, 10));                  // entrou em Lead no sábado 10/10
    await lead(41, T(9, 0, 13));                  // entrou hoje
    const rows = await staleNow({ now: T(12) });
    const l = rows.find((r) => r.stageKey === "lead")!;
    expect(l).toMatchObject({ total: 2, parados: 1 });
    expect(l.maisAntigoSeg).toBe(3 * 86_400 + 3 * 3_600);
    expect(rows.find((r) => r.stageKey === "agendado")).toMatchObject({ total: 0, parados: 0, maisAntigoSeg: null });
    expect(rows.some((r) => r.stageKey === "fechado")).toBe(false);
  });

  it("perdas por motivo e por etapa; objeções por resultado", async () => {
    const motivo = (await db.select().from(lists).where(sql`kind = 'lost_reason' and label = 'Preço'`))[0];
    const obj = (await db.select().from(lists).where(sql`kind = 'objection' and label = 'Preço'`))[0];
    const a = await lead(50, T(9)); await recordOutbound({ dealId: a, channelId: null, body: "a", at: T(9, 1) });
    await db.update(deals).set({ lostReasonId: motivo.id, objectionId: obj.id }).where(eq(deals.id, a));
    await db.transaction((tx) => moveDealTx(tx, a, "perdido", null, "manual", T(10)));
    const b = await lead(51, T(9, 5));
    await db.update(deals).set({ objectionId: obj.id }).where(eq(deals.id, b));
    await sell(b, T(11), 10_000);
    const c = await lead(52, T(9, 10));
    await db.transaction((tx) => moveDealTx(tx, c, "perdido", null, "manual", T(10)));
    const r = await lossesByReasonAndStage({ period: "hoje", now: T(18) });
    expect(r.total).toBe(2);
    expect(r.byReason).toEqual(expect.arrayContaining([{ motivo: "Preço", n: 1 }, { motivo: "Sem motivo informado", n: 1 }]));
    expect(r.byStage).toEqual(expect.arrayContaining([{ stage: "Atendimento", n: 1 }, { stage: "Lead", n: 1 }]));
    expect(r.objections.find((o) => o.objection === "Preço")).toMatchObject({ n: 2, fechados: 1, perdidos: 1, emAberto: 0 });
  });

  it("financeiro: vendido, pago, vencidas e a vencer", async () => {
    const a = await lead(60, T(9)); await sell(a, T(10), 100_000, { paidAt: T(10), paidCents: 100_000 });
    const b = await lead(61, T(9, 5)); await sell(b, T(11), 60_000, { paidAt: T(11), paidCents: 20_000, chargeAt: T(8, 0, 12) });  // vencida (restam 40 mil)
    const c = await lead(62, T(9, 10)); await sell(c, T(12), 30_000, { chargeAt: T(9, 0, 15) });                                    // a vencer
    const fin = await financeWithPaid({ period: "hoje", now: T(18) });
    expect(fin).toMatchObject({ vendas: 3, totalCents: 190_000, pagoCents: 120_000, aReceberCents: 70_000, ticketCents: 63_333 });
    expect(fin.vencidas).toMatchObject({ n: 1, cents: 40_000 });
    expect(fin.aVencer).toMatchObject({ n: 1, cents: 30_000 });
    expect(fin.vencidas.items[0].remainingCents).toBe(40_000);
    expect(fin.byMethod[0]).toMatchObject({ method: "pix", n: 3 });
    expect((await financeWithPaid({ period: "hoje", now: T(18, 0, 14) })).vendas).toBe(0);
  });

  it("qualidade dos dados conta o que falta nos leads ativos", async () => {
    const a = await lead(70, T(9)); await db.transaction((tx) => moveDealTx(tx, a, "fechado", null, "manual", T(10)));
    await lead(71, T(9, 5));
    const q = await dataQuality();
    const get = (k: string) => q.checks.find((c) => c.key === k)!;
    expect(get("fechadosSemValor")).toMatchObject({ n: 1, of: 1 });
    expect(get("fechadosSemServico")).toMatchObject({ n: 1, of: 1 });
    expect(get("semOrigem")).toMatchObject({ n: 2, of: 2 });
    expect(q.overallPct).not.toBeNull();
  });

  it("respondido pelo CRM x pelo celular", async () => {
    const [u] = await db.insert(users).values({ name: "Ana", email: "ana2@c.com", role: "atendente", passwordHash: "x" }).returning();
    const a = await lead(80, T(9)); await recordOutbound({ dealId: a, channelId: null, body: "a", userId: u.id, at: T(9, 1) });
    const b = await lead(81, T(9, 5)); await recordOutbound({ dealId: b, channelId: null, body: "a", fromPhone: true, at: T(9, 6) });
    const c = await lead(82, T(9, 10)); await recordOutbound({ dealId: c, channelId: null, body: "a", userId: u.id, at: T(9, 11) });
    expect(await crmVsPhone({ period: "hoje", now: T(18) })).toEqual({ crm: 2, celular: 1, total: 3, crmPct: 67 });
    expect(await crmVsPhone({ period: "hoje", now: T(18, 0, 14) })).toEqual({ crm: 0, celular: 0, total: 0, crmPct: null });
  });

  it("eficácia do follow-up: concluídas, no prazo, cliente respondeu em 72 h e fechou", async () => {
    const d1 = await lead(90, T(8)); const d2 = await lead(91, T(8, 5));
    const c1 = (await db.select().from(deals).where(eq(deals.id, d1)))[0].contactId, c2 = (await db.select().from(deals).where(eq(deals.id, d2)))[0].contactId;
    await db.insert(tasks).values({ dealId: d1, contactId: c1, kind: "retorno", title: "Retomar", dueAt: T(10), doneAt: T(9, 50) }).returning();
    await db.insert(tasks).values({ dealId: d2, contactId: c2, kind: "retorno", title: "Retomar", dueAt: T(11), doneAt: T(12) });
    await db.insert(tasks).values({ dealId: d2, contactId: c2, kind: "retorno", title: "Outra", dueAt: T(13) });   // aberta e vencida
    await db.insert(tasks).values({ dealId: d2, contactId: c2, kind: "geral", title: "Futura", dueAt: T(20) });    // ainda não venceu: fora
    await recordInbound({ channelId: null, externalId: "FU1", phoneRaw: phone(90), body: "quero sim", at: T(10, 30) });
    await sell(d1, T(11), 20_000);
    const rows = await followupEfficacy({ period: "hoje", now: T(18) });
    expect(rows).toEqual([{ kind: "retorno", previstas: 3, concluidas: 2, canceladas: 0, noPrazo: 1, comResposta: 1, fechados: 1, respostaPct: 50 }]);
  });

  it("mapa de calor hora x dia (domingo = 0, fuso de Salvador)", async () => {
    await lead(100, T(10)); await lead(101, T(10, 30));
    await recordInbound({ channelId: null, externalId: "H1", phoneRaw: phone(100), body: "de novo", at: T(15) });
    const m = await demandHeatmap({ period: "mes", now: T(18) });
    expect(m).toHaveLength(7); expect(m.every((r) => r.length === 24)).toBe(true);
    expect(m[2][10]).toBe(2); expect(m[2][15]).toBe(1);
    expect(m.flat().reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("pessoa contra a meta: só n >= 20, em ordem alfabética, com o próprio histórico", async () => {
    const bia = await mkUser("Bia"), ana = await mkUser("Ana"), caio = await mkUser("Caio");
    let i = 200;
    const reply = async (u: { id: string }, at: Date, secs: number) => {
      const id = await lead(i++, at);
      await recordOutbound({ dealId: id, channelId: null, body: "a", userId: u.id, at: new Date(at.getTime() + secs * 1000) });
    };
    for (let k = 0; k < 20; k++) await reply(bia, T(9, k), 60);
    for (let k = 0; k < 20; k++) await reply(ana, T(10, k), k < 10 ? 60 : 300);
    for (let k = 0; k < 3; k++) await reply(caio, T(11, k), 60);
    await db.update(stages).set({ slaMinutes: 4 }).where(eq(stages.key, "lead")); // a meta mostrada é a do Lead de agora
    const r = await personVsGoal({ period: "hoje", now: T(18) });
    expect(r.map((x) => x.name)).toEqual(["Ana", "Bia"]);
    expect(r[0]).toMatchObject({ n: 20, p50: 180, slaHitPct: 50, goalSeconds: 240, previous: null });
    expect(r[1]).toMatchObject({ n: 20, slaHitPct: 100 });
    expect((await personVsGoal({ period: "hoje", now: T(18, 0, 14) }))).toEqual([]);
  });

  it("5 números do dia comparados com ontem até a mesma hora", async () => {
    await lead(300, T(9, 0, 12));                                  // ontem 09h: entra na comparação
    await lead(301, T(19, 0, 12));                                 // ontem 19h: depois das 18h, fora
    const a = await lead(302, T(9)); await recordOutbound({ dealId: a, channelId: null, body: "a", at: T(9, 1) });
    const b = await lead(303, T(9, 5)); await moveDeal(b, "agendado", null);
    await sell(a, T(15), 80_000);
    const n = await executiveNumbers({ period: "hoje", now: T(18) });
    expect(n.leadsNovos).toMatchObject({ atual: 2, anterior: 1 });
    expect(n.pctPrimeiraRespostaNoSla).toMatchObject({ atual: 100, anterior: null, n: 1, nAnterior: 0 });
    expect(n.agendamentosMarcados).toMatchObject({ atual: 2, anterior: 0 }); // b agendou; a fechou direto (o funil é monotônico)
    expect(n.vendas).toEqual({ atual: { n: 1, cents: 80_000 }, anterior: { n: 0, cents: 0 } });
    expect(n.ticketMedio).toMatchObject({ atual: 80_000, anterior: null });
  });

  it("resumo do dia tem os números e o link para os atrasados", async () => {
    await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999994005", body: "oi", at: T(10) });
    const [g] = await db.insert(users).values({ name: "G2", email: "g2@c.com", role: "gestor", passwordHash: "x" }).returning();
    const s = await dailySummaryText({ id: g.id, role: "gestor", name: "G2", email: "g2@c.com" }, T(19));
    expect(s.text).toMatch(/1 lead novo/); expect(s.text).toMatch(/esper/);
    expect(s.links.some((l) => l.href.includes("/atendimento?filtro=atrasados"))).toBe(true);
  });

  it("resumo do dia sem movimento não inventa número e atendente vê só o que é dela", async () => {
    const ana = await mkUser("Ana");
    const g = await dailySummaryText({ id: ana.id, role: "atendente", name: "Ana", email: "ana@c.com" }, T(19));
    expect(g.text).toMatch(/Nenhum lead novo/); expect(g.text).not.toMatch(/R\$/);
    expect(g.links.some((l) => l.href.includes("atrasados"))).toBe(false);
    expect(g.highlight).toBe(true);
    expect((await dailySummaryText({ id: ana.id, role: "atendente", name: "Ana", email: "ana@c.com" }, T(15))).highlight).toBe(false);
  });
});

describe("relatórios honestos: rodada de correções 1", () => {
  beforeEach(async () => { await resetDb(); });
  const backdate = (dealId: string, at: Date) => db.execute(sql`update deal_events set created_at = ${at.toISOString()}::timestamptz where deal_id = ${dealId} and type in ('etapa_alterada', 'resposta')`);

  it("período anterior só vê o que já tinha acontecido no horário de corte", async () => {
    const y = await lead(1, T(9, 0, 12));
    await recordOutbound({ dealId: y, channelId: null, body: "a", at: T(19, 0, 12) });   // depois do corte de ontem (18h)
    await sell(y, T(20, 0, 12), 30_000);
    await backdate(y, T(19, 0, 12));
    const fr = await firstResponse({ period: "hoje", now: T(18), compare: true });
    expect(fr.previous).toMatchObject({ n: 0, slaHitPct: null, semResposta: 1 });
    const m = await funnelMilestones({ period: "hoje", now: T(18), compare: true });
    expect(m.previous).toMatchObject({ leads: 1, respondidos: 0, agendados: 0, fechados: 0, emAberto: 1 });
    const n = await executiveNumbers({ period: "hoje", now: T(18) });
    expect(n.pctPrimeiraRespostaNoSla.nAnterior).toBe(0);
    expect(n.vendas.anterior).toEqual({ n: 0, cents: 0 });
    // olhando de hoje à noite, o mesmo lead de ontem já aparece completo
    expect(await funnelMilestones({ period: "7d", now: T(21) })).toMatchObject({ respondidos: 1, fechados: 1 });
  });

  it("funil monotônico: lead fechado direto conta como agendado", async () => {
    const a = await lead(2, T(9)); await moveDeal(a, "fechado", null);
    await lead(3, T(9, 5));
    const m = await funnelMilestones({ period: "hoje", now: T(18) });
    expect(m).toMatchObject({ leads: 2, respondidos: 1, agendados: 1, fechados: 1 });
    expect(m.conv.agendado).toBe(50);
    expect((await sourceToSale({ period: "hoje", now: T(18) })).find((r) => r.origem === "Não identificada")).toMatchObject({ agendados: 1, fechados: 1 });
  });

  it("semResposta não conta lead iniciado pela Casa", async () => {
    await recordOutbound({ phoneRaw: phone(4), channelId: null, body: "oi, tudo bem?", fromPhone: true, at: T(9) });
    await lead(5, T(9, 5));
    expect((await firstResponse({ period: "hoje", now: T(18) })).semResposta).toBe(1);
    expect((await funnelMilestones({ period: "hoje", now: T(18) })).leads).toBe(2);
  });

  it("follow-up: tarefa cancelada não é concluída e vem à parte", async () => {
    const d = await lead(6, T(8)); const c = (await db.select().from(deals).where(eq(deals.id, d)))[0].contactId;
    const [ok] = await db.insert(tasks).values({ dealId: d, contactId: c, kind: "retorno", title: "a", dueAt: T(10) }).returning();
    const [no] = await db.insert(tasks).values({ dealId: d, contactId: c, kind: "retorno", title: "b", dueAt: T(10) }).returning();
    await db.transaction(async (tx) => { await completeTaskTx(tx, ok.id, null, "concluida", T(9, 30)); await completeTaskTx(tx, no.id, null, "cancelada", T(9, 40)); });
    expect(await followupEfficacy({ period: "hoje", now: T(18) })).toEqual([
      { kind: "retorno", previstas: 1, concluidas: 1, canceladas: 1, noPrazo: 1, comResposta: 0, fechados: 0, respostaPct: 0 },
    ]);
  });

  it("ticket médio divide só pelas vendas que têm valor", async () => {
    const a = await lead(7, T(9)); await sell(a, T(10), 100_000);
    const b = await lead(8, T(9, 5)); await db.transaction((tx) => moveDealTx(tx, b, "fechado", null, "manual", T(11)));
    const n = await executiveNumbers({ period: "hoje", now: T(18) });
    expect(n.vendas.atual).toEqual({ n: 2, cents: 100_000 });
    expect(n.ticketMedio).toMatchObject({ atual: 100_000, n: 1 });
    const fin = await financeWithPaid({ period: "hoje", now: T(18) });
    expect(fin).toMatchObject({ vendas: 2, vendasComValor: 1, ticketCents: 100_000 });
    expect((await financeWithPaid({ period: "hoje", now: T(18, 0, 14) })).ticketCents).toBeNull();
    expect((await executiveNumbers({ period: "hoje", now: T(18, 0, 14) })).ticketMedio).toMatchObject({ atual: null, n: 0 });
  });

  it("resumo com amostra pequena mostra 'x de y', não porcentagem", async () => {
    for (let i = 0; i < 3; i++) { const id = await lead(10 + i, T(9, i)); await recordOutbound({ dealId: id, channelId: null, body: "a", at: new Date(T(9, i).getTime() + (i === 0 ? 300_000 : 60_000)) }); }
    const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const s = await dailySummaryText({ id: g.id, role: "gestor", name: "G", email: "g@c.com" }, T(18));
    expect(s.text).toMatch(/2 de 3 dentro do prazo/); expect(s.text).not.toMatch(/66%|67%/);
  });

  it("espera sem SLA na etapa usa o SLA do Lead (ou 2 min), igual à primeira resposta", async () => {
    await db.update(stages).set({ slaMinutes: null }).where(eq(stages.key, "atendimento"));
    const a = await lead(20, T(9)); await recordOutbound({ dealId: a, channelId: null, body: "a", at: T(9, 1) });
    await recordInbound({ channelId: null, externalId: "S2", phoneRaw: phone(20), body: "e então?", at: T(10) });
    const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const s = await dailySummaryText({ id: g.id, role: "gestor", name: "G", email: "g@c.com" }, T(12));
    expect(s.text).toMatch(/1 esperando resposta agora \(1 fora do prazo\)/);
  });

  it("janela anterior é aberta no fim: o instante da fronteira não conta duas vezes", async () => {
    await lead(30, T(0, 0, 1));   // 1/10 00:00 local, exatamente onde o mês atual começa
    const m = await funnelMilestones({ period: "mes", now: T(12, 0, 31), compare: true });
    expect(m.leads).toBe(1);
    expect(m.previous!.leads).toBe(0);
  });

  it("resumo: tarefa sem lead de contato ignorado não conta; amanhã mostra agendados e cobranças", async () => {
    const [ign] = await db.insert(contacts).values({ phoneE164: "+5571999990001", ignored: true }).returning();
    const [ok] = await db.insert(contacts).values({ phoneE164: "+5571999990002" }).returning();
    await db.insert(tasks).values({ contactId: ign.id, kind: "geral", title: "x", dueAt: T(9) });
    await db.insert(tasks).values({ contactId: ok.id, kind: "geral", title: "y", dueAt: T(9) });
    const a = await lead(40, T(9)); await moveDeal(a, "agendado", null);
    await db.update(deals).set({ scheduledAt: T(10, 0, 14) }).where(eq(deals.id, a));
    const b = await lead(41, T(9, 5)); await sell(b, T(10), 50_000, { chargeAt: T(9, 0, 14), paidAt: T(10), paidCents: 20_000 });
    const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const s = await dailySummaryText({ id: g.id, role: "gestor", name: "G", email: "g@c.com" }, T(18));
    expect(s.text).toMatch(/1 tarefa atrasada/);
    expect(s.text).toMatch(/Amanhã: 1 agendado/);
    expect(s.text).toMatch(/Cobranças de amanhã: 1 \(R\$ 300,00\)/);
    const at = await dailySummaryText({ id: g.id, role: "atendente", name: "A", email: "a@c.com" }, T(18));
    expect(at.text).not.toMatch(/R\$/);
  });
});

describe("relatórios: correções da T13a (T13b)", () => {
  beforeEach(async () => { await resetDb(); });
  const gestor = async () => (await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0];

  it("semResposta: figurinha da cliente não abre espera", async () => {
    // conversa iniciada pela Casa; a cliente responde só com uma figurinha (deals.ts não abre espera)
    await recordOutbound({ phoneRaw: phone(60), channelId: null, body: "oi, tudo bem?", fromPhone: true, at: T(9) });
    await recordInbound({ channelId: null, externalId: "ST1", phoneRaw: phone(60), body: null, kind: "sticker", at: T(9, 5) });
    expect((await firstResponse({ period: "hoje", now: T(18) })).semResposta).toBe(0);
    // texto da cliente abre a espera: agora conta
    await recordInbound({ channelId: null, externalId: "TX1", phoneRaw: phone(60), body: "quanto custa?", at: T(10) });
    expect((await firstResponse({ period: "hoje", now: T(18) })).semResposta).toBe(1);
  });

  it("resumo: etapa com SLA 0 usa o prazo de reserva (0 é sem prazo)", async () => {
    await db.update(stages).set({ slaMinutes: 0 }).where(eq(stages.key, "atendimento"));
    const a = await lead(61, T(9)); await recordOutbound({ dealId: a, channelId: null, body: "a", at: T(9, 1) });
    await recordInbound({ channelId: null, externalId: "SLA0", phoneRaw: phone(61), body: "e então?", at: T(10) });
    const g = await gestor();
    const s = await dailySummaryText(g, T(10, 1)); // 1 min de espera, reserva de 2 min
    expect(s.text).toMatch(/1 esperando resposta agora/); expect(s.text).not.toMatch(/fora do prazo/);
    expect((await dailySummaryText(g, T(10, 5))).text).toMatch(/1 esperando resposta agora \(1 fora do prazo\)/);
  });

  it("amanhã perto da meia-noite de Salvador (23:30 local = 02:30 UTC)", async () => {
    const now = T(23, 30);
    expect(now.toISOString()).toBe("2026-10-14T02:30:00.000Z");
    const a = await lead(62, T(9)); await moveDeal(a, "agendado", null);
    await db.update(deals).set({ scheduledAt: T(0, 30, 14) }).where(eq(deals.id, a)); // 00:30 do dia seguinte: entra em amanhã
    const b = await lead(63, T(9, 5)); await moveDeal(b, "agendado", null);
    await db.update(deals).set({ scheduledAt: T(0, 30, 15) }).where(eq(deals.id, b)); // depois de amanhã: fora
    const c = await lead(64, T(9, 10)); await moveDeal(c, "agendado", null);
    await db.update(deals).set({ scheduledAt: T(23, 0, 13) }).where(eq(deals.id, c)); // hoje 23h: fora
    const s = await dailySummaryText(await gestor(), now);
    expect(s.text).toMatch(/Amanhã: 1 agendado(?!s)/);
  });
});
