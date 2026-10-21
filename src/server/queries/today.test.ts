import { eq } from "drizzle-orm";
import { permsFor } from "../../../test/perms";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { alerts, appointments, contactStats, contacts, deals, professionals, stages, tasks, users, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { getToday } from "./today";

beforeEach(async () => { await resetDb(); });

const NOW = new Date(Date.UTC(2026, 9, 13, 15, 0)); // terça 12h em Salvador
const bahia = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));

async function setup() {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gestora] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const stage = async (kind: string) => (await db.select().from(stages)).find((s) => s.kind === kind)!;
  let n = 0;
  const mk = async (ownerId: string | null, over: Partial<typeof deals.$inferInsert> = {}, kind = "atendimento") => {
    n++;
    const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+55719999100${n}` }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: (await stage(kind)).id, ownerId, ...over }).returning();
    return { c, d };
  };
  let k = 0;
  const alert = (dealId: string, over: Partial<typeof alerts.$inferInsert> = {}) =>
    db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: `k${++k}`, waitKey: `espera:${dealId}`, ...over });
  const task = (c: { id: string }, d: { id: string } | null, over: Partial<typeof tasks.$inferInsert>) =>
    db.insert(tasks).values({ contactId: c.id, dealId: d?.id ?? null, kind: "proxima_acao", title: "Ligar", dueAt: NOW, ...over }).returning();
  return { ana, bia, gestora, mk, alert, task };
}
const as = (u: { id: string; name: string; email: string; role: "gestor" | "atendente" }) => ({ id: u.id, name: u.name, email: u.email, perms: permsFor(u.role), profileId: null, profileName: "", availability: "ausente" });

describe("Hoje: contador de atrasados", () => {
  it("conta leads com espera aberta, não alertas: 2 alertas da mesma espera (nível 1 e 2) valem 1", async () => {
    const { ana, gestora, mk, alert } = await setup();
    const { d } = await mk(ana.id, { awaitingReplySince: bahia(13, 11) });
    await alert(d.id, { userId: ana.id, level: 1 });
    await alert(d.id, { audience: "gestao", level: 2, dedupeKey: "k-nivel2", waitKey: `espera:${d.id}:n2` });
    expect((await getToday(as(gestora), NOW)).late).toBe(1);
    expect((await getToday(as(ana), NOW)).late).toBe(1);
  });
  it("não depende do SLA da etapa: esperando há 1 min sem alerta não é atrasado; com alerta é", async () => {
    const { ana, gestora, mk, alert } = await setup();
    const { d } = await mk(ana.id, { awaitingReplySince: new Date(NOW.getTime() - 60_000) });
    expect((await getToday(as(gestora), NOW)).late).toBe(0);
    await alert(d.id);
    expect((await getToday(as(gestora), NOW)).late).toBe(1);
  });
  it("atendente conta os dela e os sem dono, igual à Fila e ao sino; não os de outra pessoa", async () => {
    const { ana, bia, mk, alert } = await setup();
    const a = await mk(ana.id), b = await mk(bia.id), s = await mk(null);
    await alert(a.d.id); await alert(b.d.id); await alert(s.d.id);
    expect((await getToday(as(ana), NOW)).late).toBe(2);
  });
});

describe("Hoje v3: Para você agora", () => {
  it("as conversas esperando VOCÊ são só as que têm você como dona (a equipe toda continua em Esperando resposta)", async () => {
    const { ana, bia, gestora, mk } = await setup();
    const sp = { awaitingReplySince: new Date(NOW.getTime() - 60_000) };
    const a = await mk(ana.id, sp), b = await mk(bia.id, sp), s = await mk(null, sp), g = await mk(gestora.id, sp);
    const tg = await getToday(as(gestora), NOW);
    expect(new Set(tg.waiting.map((w) => w.id))).toEqual(new Set([a.d.id, b.d.id, s.d.id, g.d.id]));
    expect(tg.waitingMine.map((w) => w.id)).toEqual([g.d.id]);
    expect(tg.waiting.find((w) => w.id === a.d.id)!.ownerId).toBe(ana.id);
    const ta = await getToday(as(ana), NOW);
    expect(ta.waitingMine.map((w) => w.id)).toEqual([a.d.id]); // a sem dono aparece em Esperando resposta, não em "esperando você"
  });
});

describe("Hoje: próximas ações", () => {
  it("só as do usuário, vencidas primeiro e depois as de hoje; amanhã, concluídas, outra pessoa e comparecimento ficam de fora", async () => {
    const { ana, bia, mk, task } = await setup();
    const { c, d } = await mk(ana.id);
    await task(c, d, { title: "hoje 17h", dueAt: bahia(13, 17), assigneeId: ana.id });
    await task(c, d, { title: "vencida ontem", dueAt: bahia(12, 10), assigneeId: ana.id, kind: "retorno" });
    await task(c, d, { title: "amanhã", dueAt: bahia(14, 9), assigneeId: ana.id });
    await task(c, d, { title: "feita", dueAt: bahia(13, 9), assigneeId: ana.id, doneAt: bahia(13, 10) });
    await task(c, d, { title: "da Bia", dueAt: bahia(13, 9), assigneeId: bia.id });
    await task(c, d, { title: "comparecimento", dueAt: bahia(13, 9), assigneeId: ana.id, kind: "comparecimento" });
    const t = await getToday(as(ana), NOW);
    expect(t.tasks.map((x) => x.title)).toEqual(["vencida ontem", "hoje 17h"]);
    expect(t.tasks.map((x) => x.overdue)).toEqual([true, false]);
    expect(t.tasks[0]).toMatchObject({ dealId: d.id, name: c.name });
  });
  it("lead arquivado e contato ignorado saem das próximas ações", async () => {
    const { ana, mk, task } = await setup();
    const arq = await mk(ana.id, { archivedAt: new Date() }), ign = await mk(ana.id);
    await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, ign.c.id));
    await task(arq.c, arq.d, { assigneeId: ana.id, dueAt: bahia(13, 9) });
    await task(ign.c, ign.d, { assigneeId: ana.id, dueAt: bahia(13, 9) });
    expect((await getToday(as(ana), NOW)).tasks).toHaveLength(0);
  });
});

describe("Hoje: comparecimentos", () => {
  it("agendados de ontem sem comparecimento e os de hoje cujo horário já passou; os de hoje à tarde e os já marcados não", async () => {
    const { ana, mk } = await setup();
    await mk(ana.id, { scheduledAt: bahia(12, 15) }, "agendado");
    await mk(ana.id, { scheduledAt: bahia(13, 10) }, "agendado");
    await mk(ana.id, { scheduledAt: bahia(13, 16) }, "agendado");
    await mk(ana.id, { scheduledAt: bahia(12, 9), attendance: "compareceu" }, "agendado");
    const t = await getToday(as(ana), NOW);
    expect(t.attendance.map((a) => a.scheduledAt)).toEqual([bahia(12, 15).toISOString(), bahia(13, 10).toISOString()]);
  });
});

describe("Hoje: agenda de hoje", () => {
  it("lista os horários de hoje da Agenda (não o funil): em ordem, com profissional e estado; cancelado, amanhã e gêmeo do Avec ficam de fora", async () => {
    const { ana, mk } = await setup();
    const [pri] = await db.insert(professionals).values({ name: "PRISCILA" }).returning();
    let k = 0;
    const ap = (over: Partial<typeof appointments.$inferInsert> & { startsAt: Date }) =>
      db.insert(appointments).values({ serviceLabel: "Escova", status: "agendado", origin: "avec", externalKey: `h:${++k}`, professionalId: pri.id, ...over }).returning().then((r) => r[0]);
    const cedo = await ap({ clientName: "Atrasada", startsAt: bahia(13, 9) });
    const chegou = await ap({ clientName: "Na Casa", startsAt: bahia(13, 11, 50), status: "chegou" });
    const tarde = await ap({ clientName: "Confirmada", startsAt: bahia(13, 16), status: "confirmado" });
    await ap({ clientName: "Cancelada", startsAt: bahia(13, 14), status: "cancelado" });
    await ap({ clientName: "Amanhã", startsAt: bahia(14, 9) });
    await ap({ clientName: "Gêmea", startsAt: bahia(13, 10), avecTwinOf: cedo.id });
    const { d } = await mk(ana.id, { scheduledAt: bahia(13, 17) }, "agendado"); // conversa em Agendado sem horário: a Agenda mostra
    const t = await getToday(as(ana), NOW);
    expect(t.agenda.map((a) => a.name)).toEqual(["Atrasada", "Na Casa", "Confirmada", "Cliente 1"]);
    expect(t.agenda[0]).toMatchObject({ professional: "Priscila", service: "Escova", state: "sembaixa", href: `/agenda?destaque=${cedo.id}` });
    expect(t.agenda[1]).toMatchObject({ state: "chegou", href: `/agenda?destaque=${chegou.id}` });
    expect(t.agenda[2]).toMatchObject({ state: "confirmado", stateLabel: "Confirmado", href: `/agenda?destaque=${tarde.id}` });
    expect(t.agenda[3]).toMatchObject({ professional: null, href: `/atendimento?lead=${d.id}` });
  });
});

describe("Hoje: o que está esperando e quem é vermelho", () => {
  it("só tem `late` quem tem alerta de espera aberto; passou do SLA sem alerta não é atrasado (uma regra só, a do contador)", async () => {
    const { ana, mk, alert } = await setup();
    const longe = new Date(Date.now() - 6 * 3_600_000);
    const comAlerta = await mk(ana.id, { awaitingReplySince: longe }, "lead");
    const semAlerta = await mk(ana.id, { awaitingReplySince: longe }, "lead");
    await alert(comAlerta.d.id);
    const t = await getToday(as(ana), NOW);
    const by = new Map(t.waiting.map((w) => [w.id, w.late]));
    expect(by.get(comAlerta.d.id)).toBe(true);
    expect(by.get(semAlerta.d.id)).toBe(false);
    expect(t.waiting.filter((w) => w.late).length).toBe(t.late); // o contador e as linhas vermelhas batem
  });
});

describe("Hoje: contato ignorado fica de fora", () => {
  it("esperando, agenda, follow-up, cobrança e contagem de novos não trazem lead de contato ignorado", async () => {
    const { ana, mk } = await setup();
    const agora = new Date();
    const mkIgn = async (kind: string, over: Partial<typeof deals.$inferInsert>) => {
      const x = await mk(ana.id, over, kind);
      await db.update(contacts).set({ ignored: true }).where(eq(contacts.id, x.c.id));
      return x;
    };
    const ign = [
      await mkIgn("lead", { awaitingReplySince: agora }),
      await mkIgn("agendado", { scheduledAt: bahia(13, 16) }),
      await mkIgn("followup", {}),
      await mkIgn("atendimento", { chargeAt: agora }),
    ];
    const ok = [
      await mk(ana.id, { awaitingReplySince: agora }, "lead"),
      await mk(ana.id, { scheduledAt: bahia(13, 16) }, "agendado"),
      await mk(ana.id, {}, "followup"),
      await mk(ana.id, { chargeAt: agora }, "atendimento"),
    ];
    const t = await getToday(as(ana), NOW);
    const ids = new Set([...[...t.waiting, ...t.followups, ...t.dues].map((i) => i.id), ...t.agenda.map((a) => a.dealId)]);
    for (const x of ign) expect(ids.has(x.d.id)).toBe(false);
    for (const x of ok) expect(ids.has(x.d.id)).toBe(true);
    expect(Number(t.counts.abertos)).toBe(4); // só os 4 do controle
  });
});

describe("Hoje: combinado vencido já respondido", () => {
  it("a Casa escreveu depois do vencimento: o item diz e sugere marcar como feito", async () => {
    const { ana, mk, task } = await setup();
    const a = await mk(ana.id, { lastOutboundAt: new Date(NOW.getTime() - 30 * 60_000) });
    const b = await mk(ana.id, { lastOutboundAt: new Date(NOW.getTime() - 5 * 3_600_000) });
    await task(a.c, a.d, { title: "Mandar valores", dueAt: new Date(NOW.getTime() - 2 * 3_600_000), assigneeId: ana.id });
    await task(b.c, b.d, { title: "Retomar", dueAt: new Date(NOW.getTime() - 2 * 3_600_000), assigneeId: ana.id });
    const t = await getToday(as(ana), NOW);
    expect(t.tasks.map((x) => [x.title, x.answeredAfter])).toEqual([["Mandar valores", true], ["Retomar", false]]);
  });
});

describe("Hoje: pedido da cliente não se perde entre os vencidos antigos (psico r68 #10)", () => {
  it("pedido pelo link primeiro, depois os recentes; os vencidos há mais de 7 dias vão para o fim", async () => {
    const { ana, mk, task } = await setup();
    const a = await mk(ana.id, {}), b = await mk(ana.id, {}), c = await mk(ana.id, {});
    const H = 3_600_000;
    await task(a.c, a.d, { title: "Antigo de agosto", dueAt: new Date(NOW.getTime() - 40 * 24 * H), assigneeId: ana.id });
    await task(b.c, b.d, { title: "Ontem", dueAt: new Date(NOW.getTime() - 26 * H), assigneeId: ana.id });
    await task(c.c, c.d, { title: "Remarcar (pediu pelo link)", dueAt: new Date(NOW.getTime() - 60_000), assigneeId: ana.id });
    const t = await getToday(as(ana), NOW);
    expect(t.tasks.map((x) => x.title)).toEqual(["Remarcar (pediu pelo link)", "Ontem", "Antigo de agosto"]);
  });
});

describe("Hoje: Sem responsável e aniversários", () => {
  it("gestão vê a aba Sem responsável; atendente não recebe a lista", async () => {
    const { ana, gestora, mk, task } = await setup();
    const { c, d } = await mk(null);
    await task(c, d, { title: "Retomar orçamento", dueAt: new Date(NOW.getTime() - 3_600_000), assigneeId: null });
    await task(c, d, { title: "Da Ana", assigneeId: ana.id });
    const g = await getToday(as(gestora), NOW);
    expect(g.unassigned!.map((t) => t.title)).toEqual(["Retomar orçamento"]);
    expect(g.tasks).toEqual([]);
    expect((await getToday(as(ana), NOW)).unassigned).toBeNull();
  });

  it("aniversários sem exigir lead, no dia certo (29, 30 e 31 não caem no 28) e no escopo de quem vê", async () => {
    const { ana, bia, gestora, mk } = await setup();
    const now = new Date(Date.UTC(2026, 9, 27, 15, 0)); // terça 27/10, 12h em Salvador
    const daBia = await mk(bia.id);
    await db.update(contacts).set({ birthDay: 29, birthMonth: 10 }).where(eq(contacts.id, daBia.c.id));
    await db.insert(contacts).values([
      { name: "Sem Lead", phoneE164: "+5571999920001", birthDay: 30, birthMonth: 10 },
      { name: "Dia 31", phoneE164: "+5571999920002", birthDay: 31, birthMonth: 10 },
      { name: "Longe", phoneE164: "+5571999920003", birthDay: 10, birthMonth: 11 },
      { name: "Ignorada", phoneE164: "+5571999920004", birthDay: 28, birthMonth: 10, ignored: true },
    ]);
    const g = await getToday(as(gestora), now);
    expect(g.birthdays.map((b) => [b.name, b.label])).toEqual([["Cliente 1", "29/10"], ["Sem Lead", "30/10"], ["Dia 31", "31/10"]]);
    expect(g.birthdays.find((b) => b.name === "Sem Lead")!.dealId).toBeNull();
    expect(g.birthdays.find((b) => b.name === "Cliente 1")!.dealId).toBe(daBia.d.id);
    expect((await getToday(as(ana), now)).birthdays.map((b) => b.name)).toEqual(["Sem Lead", "Dia 31"]); // a da Bia fica com a Bia
  });

  it("aniversário de hoje: primeiro as fiéis (3+ visitas) e as recentes (visita nos últimos 90 dias), no dia de Salvador; com a foto", async () => {
    const { gestora } = await setup();
    const now = new Date(Date.UTC(2026, 9, 16, 2, 30)); // 15/10 23h30 em Salvador (já é 16/10 em UTC)
    const [a, b, c, d] = await db.insert(contacts).values([
      { name: "A Nova", phoneE164: "+5571999930001", birthDay: 15, birthMonth: 10 },
      { name: "B Fiel", phoneE164: "+5571999930002", birthDay: 15, birthMonth: 10, avatarPath: "x.jpg" },
      { name: "C Recente", phoneE164: "+5571999930003", birthDay: 15, birthMonth: 10 },
      { name: "D Amanhã", phoneE164: "+5571999930004", birthDay: 16, birthMonth: 10 },
    ]).returning();
    await db.insert(contactStats).values([
      { contactId: a.id, visits: 1, lastVisitOn: "2025-01-10" },
      { contactId: b.id, visits: 5, lastVisitOn: "2025-12-01" },
      { contactId: c.id, visits: 1, lastVisitOn: "2026-09-20" },
    ]);
    const g = await getToday(as(gestora), now);
    expect(g.birthdays.map((x) => [x.name, x.today, x.loyal])).toEqual([["B Fiel", true, true], ["C Recente", true, true], ["A Nova", true, false], ["D Amanhã", false, false]]);
    expect(g.birthdays.find((x) => x.name === "B Fiel")!.hasAvatar).toBe(true);
    void d;
  });

  it("29/02 em ano que não é bissexto aparece no 28/02", async () => {
    const { gestora } = await setup();
    await db.insert(contacts).values({ name: "Bissexta", phoneE164: "+5571999920009", birthDay: 29, birthMonth: 2 });
    const g = await getToday(as(gestora), new Date(Date.UTC(2027, 1, 25, 15, 0)));
    expect(g.birthdays.map((b) => [b.name, b.label])).toEqual([["Bissexta", "29/02"]]);
  });
});

describe("Hoje: Na Casa agora", () => {
  it("quem está no salão (Chegou, Em atendimento ou entre dois serviços da visita), com serviço, profissional e desde quando", async () => {
    const { ana: atendente, gestora } = await setup();
    const [pro, pro2] = await db.insert(professionals).values([{ name: "Carla" }, { name: "Duda" }]).returning();
    const [paula, rita, joana, lia] = await db.insert(contacts).values([
      { name: "Paula Souza", phoneE164: "+5571999940001", avatarPath: "avatars/p.jpg" }, { name: "Rita Melo", phoneE164: "+5571999940002" },
      { name: "Joana Lima", phoneE164: "+5571999940003" }, { name: "Lia Santos", phoneE164: "+5571999940004" },
    ]).returning();
    const [d] = await db.insert(deals).values({ contactId: paula.id, stageId: (await db.select().from(stages)).find((x) => x.kind === "agendado")!.id, ownerId: atendente.id }).returning();
    const [v] = await db.insert(visits).values({ contactId: rita.id, day: "2026-10-13" }).returning();
    let k = 0;
    const ap = (o: Partial<typeof appointments.$inferInsert> & { startsAt: Date; status: string }) =>
      db.insert(appointments).values({ serviceLabel: "Corte", origin: "crm", externalKey: `h:${++k}`, professionalId: pro.id, ...o });
    await ap({ contactId: paula.id, startsAt: bahia(13, 11), status: "em_atendimento", arrivedAt: bahia(13, 10, 50), startedAt: bahia(13, 11) });
    await ap({ contactId: rita.id, visitId: v.id, startsAt: bahia(13, 10), status: "compareceu", arrivedAt: bahia(13, 9, 58) });
    await ap({ contactId: rita.id, visitId: v.id, startsAt: bahia(13, 13), status: "agendado", serviceLabel: "Hidratação", professionalId: pro2.id });
    await ap({ contactId: joana.id, startsAt: bahia(13, 9), status: "compareceu", arrivedAt: bahia(13, 8, 55) }); // já foi embora
    await ap({ contactId: lia.id, startsAt: bahia(13, 15), status: "agendado" }); // ainda não chegou
    const g = await getToday(as(gestora), NOW);
    expect(g.naCasa.map((x) => [x.name, x.service, x.professional, x.since, x.started, x.dealId])).toEqual([
      ["Rita Melo", "Hidratação", "Duda", bahia(13, 9, 58).toISOString(), false, null],
      ["Paula Souza", "Corte", "Carla", bahia(13, 10, 50).toISOString(), true, d.id],
    ]);
    expect(g.naCasa.find((x) => x.name === "Paula Souza")!.hasAvatar).toBe(true);
  });
});
