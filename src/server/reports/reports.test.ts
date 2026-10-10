import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "../db";
import { users } from "../db/schema";
import { recordInbound, recordOutbound, moveDeal, moveDealTx } from "../domain/deals";
import { updateDeal } from "../domain/updates";
import { funnel, responseTimes, origins, finance, summary, toCsv, periodStart } from "./index";
import {
  periodWindow, firstResponse, funnelMilestones, staleNow, sourceToSale, lossesByReasonAndStage, financeWithPaid, dataQuality,
  crmVsPhone, followupEfficacy, demandHeatmap, personVsGoal, executiveNumbers, dailySummaryText,
} from "./index";
import { archiveDeals } from "../domain/archive";
import { deals, lists, leadSources, tasks } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { resetDb } from "../../../test/db";

// Terça 2026-10-13 12:00 em Salvador: dentro do expediente, no mês corrente da data fixa.
const NOW = new Date("2026-10-13T15:00:00Z").getTime();

describe("relatórios", () => {
  let ana: string;
  beforeEach(async () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    await resetDb();
    [{ id: ana }] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
    const now = NOW;
    for (let i = 0; i < 3; i++) {
      const r = await recordInbound({ channelId: null, externalId: `m${i}`, phoneRaw: `7199900001${i}`, body: i === 0 ? "vim pelo instagram" : "oi", at: new Date(now - 300_000) });
      if (!("dealId" in r)) throw new Error();
      await recordOutbound({ dealId: r.dealId, channelId: null, body: "oi", userId: ana, at: new Date(now - 300_000 + (i + 1) * 60_000) });
      if (i === 0) { await updateDeal(r.dealId, { valueCents: 115800, paymentMethod: "pix" }, ana); await moveDeal(r.dealId, "fechado", ana); }
    }
  });

  afterEach(() => vi.useRealTimers());

  it("funil conta quem passou por cada etapa", async () => {
    const f = await funnel({ period: "mes" });
    expect(f.find((s) => s.key === "lead")!.reached).toBe(3);
    expect(f.find((s) => s.key === "atendimento")!.reached).toBe(3);
    expect(f.find((s) => s.key === "fechado")!.reached).toBe(1);
  });

  it("tempo de resposta por pessoa contra a meta de 2 min", async () => {
    const [r] = await responseTimes({ period: "mes" });
    expect(r.name).toBe("Ana");
    expect(r.responses).toBe(3);
    expect(r.avgSeconds).toBe(120);
    expect(r.withinGoal).toBe(2);
  });

  it("origem, financeiro e resumo", async () => {
    expect((await origins({ period: "mes" })).find((o) => o.origin === "Instagram")).toMatchObject({ leads: 1, won: 1, revenueCents: 115800 });
    const fin = await finance({ period: "mes" });
    expect(fin).toMatchObject({ totalCents: 115800, deals: 1, ticketCents: 115800 });
    expect(fin.byMethod[0].method).toBe("pix");
    expect(await summary({ period: "mes" })).toMatchObject({ leads: 3, won: 1, open: 2 });
    expect((await funnel({ period: "mes", ownerId: ana })).find((s) => s.key === "lead")!.reached).toBe(3);
  });

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
    expect(rows).toEqual([{ kind: "retorno", previstas: 3, concluidas: 2, noPrazo: 1, comResposta: 1, fechados: 1, respostaPct: 50 }]);
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
    const r = await personVsGoal({ period: "hoje", now: T(18) });
    expect(r.map((x) => x.name)).toEqual(["Ana", "Bia"]);
    expect(r[0]).toMatchObject({ n: 20, p50: 180, slaHitPct: 50, goalSeconds: 120, previous: null });
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
    expect(n.agendamentosMarcados).toMatchObject({ atual: 1, anterior: 0 });
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
