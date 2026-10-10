import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, messages, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { countLateLeads } from "./late-count";
import { getQueue, getQueueItem, nextWaitingId, queueStageLabel, type QueueResult } from "./queue";
import type { QueueView } from "../../lib/queue";

beforeEach(async () => { await resetDb(); });

// Quarta-feira 15:00 em Salvador (18:00Z): dentro do expediente padrão (seg–sex 8–20), então a espera conta minuto a minuto.
const NOW = new Date("2026-10-07T18:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const days = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const asUser = (u: { id: string; name: string; email: string; role: "gestor" | "atendente" }) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function setup() {
  const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [bia] = await db.insert(users).values({ name: "Bia", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [gestora] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  const st = await db.select().from(stages);
  const stage = (key: string) => st.find((s) => s.key === key)!;
  let n = 0;
  type Over = Partial<typeof deals.$inferInsert> & { stage?: string; ignored?: boolean; client?: boolean; last?: { direction: "in" | "out"; body?: string; at?: Date; kind?: string } };
  const lead = async (over: Over = {}) => {
    n++;
    const { stage: stageKey, ignored, client, last, ...rest } = over;
    const [c] = await db.insert(contacts).values({ name: `Cliente ${n}`, phoneE164: `+5571999900${String(n).padStart(2, "0")}`, ignored: ignored ?? false, isClient: client ?? false }).returning();
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: stage(stageKey ?? "lead").id, stageEnteredAt: ago(1), createdAt: ago(1), ...rest }).returning();
    if (last) await db.insert(messages).values({ dealId: d.id, contactId: c.id, direction: last.direction, body: last.body ?? "oi", kind: last.kind ?? "text", createdAt: last.at ?? ago(1) });
    return { ...d, contactId: c.id };
  };
  let k = 0;
  const lateAlert = (dealId: string) => db.insert(alerts).values({ dealId, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: `k${++k}`, waitKey: `espera:${dealId}:${k}` });
  return { ana, bia, gestora, lead, lateAlert, stage };
}

const keys = (q: QueueResult) => q.sections.map((s) => s.key);
const ids = (q: QueueResult, key: string) => (q.sections.find((s) => s.key === key)?.items ?? []).map((i) => i.dealId);
const all = (q: QueueResult) => q.sections.flatMap((s) => s.items.map((i) => i.dealId));

describe("getQueue: seções por urgência", () => {
  it("atrasado vem antes de perto, que vem antes de aguardando; cada seção pela maior espera", async () => {
    const { gestora, lead, lateAlert } = await setup();
    const aguardando = await lead({ awaitingReplySince: ago(0.4) }); // Lead tem prazo de 2 min: 0,4 min é 20% do prazo
    const perto = await lead({ awaitingReplySince: ago(1.2) }); // 60% do prazo
    const atrasado = await lead({ awaitingReplySince: ago(30) });
    const atrasado2 = await lead({ awaitingReplySince: ago(45) });
    await lateAlert(atrasado.id); await lateAlert(atrasado2.id);
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(keys(q)).toEqual(["atrasados", "perto", "aguardando"]);
    expect(ids(q, "atrasados")).toEqual([atrasado2.id, atrasado.id]);
    expect(ids(q, "perto")).toEqual([perto.id]);
    expect(ids(q, "aguardando")).toEqual([aguardando.id]);
  });

  it("perto do prazo é acima de 50% do prazo da etapa, contado só no expediente", async () => {
    const { gestora, lead } = await setup();
    const abaixo = await lead({ awaitingReplySince: ago(0.9) }); // 45% de 2 min
    const acima = await lead({ awaitingReplySince: ago(1.1) }); // 55%
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "aguardando")).toEqual([abaixo.id]);
    expect(ids(q, "perto")).toEqual([acima.id]);
  });

  it("com a Casa fechada a espera não anda: sábado 16h59 até domingo de manhã ainda é aguardando", async () => {
    const { gestora, lead } = await setup();
    const d = await lead({ awaitingReplySince: new Date("2026-10-10T19:59:30Z") }); // 30 s antes de fechar (sábado fecha às 17h)
    const q = await getQueue(asUser(gestora), { now: new Date("2026-10-11T13:00:00Z") });
    expect(keys(q)).toEqual(["aguardando"]);
    expect(ids(q, "aguardando")).toEqual([d.id]);
  });

  it("lead arquivado, contato ignorado e lead fechado ficam fora", async () => {
    const { gestora, lead, lateAlert } = await setup();
    const ok = await lead({ awaitingReplySince: ago(1) });
    const arq = await lead({ awaitingReplySince: ago(1), archivedAt: ago(5) });
    const ign = await lead({ awaitingReplySince: ago(1), ignored: true });
    const fechado = await lead({ stage: "fechado", closedAt: ago(10) });
    await lateAlert(arq.id); await lateAlert(ign.id);
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(all(q)).toEqual([ok.id]);
    expect(all(q)).not.toContain(fechado.id);
    expect(q.counts.total).toBe(1);
  });

  it("sem próxima ação há mais que stale_days vai para parados; com próxima ação futura não", async () => {
    const { gestora, lead } = await setup();
    const parado = await lead({ stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    const comAcao = await lead({ stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    await db.insert(tasks).values({ dealId: comAcao.id, contactId: comAcao.contactId, kind: "proxima_acao", title: "Mandar valores", dueAt: new Date(NOW.getTime() + 2 * 86_400_000) });
    const recente = await lead({ stage: "atendimento", stageEnteredAt: ago(60), last: { direction: "out" } });
    const semLimite = await lead({ stage: "agendado", stageEnteredAt: days(10), last: { direction: "out" } }); // Agendado não tem stale_days
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "parados")).toEqual([parado.id]);
    expect(ids(q, "aguardando-cliente").sort()).toEqual([comAcao.id, recente.id, semLimite.id].sort());
  });

  it("aguardando a cliente fica separado: a Casa respondeu e a bola está com ela", async () => {
    const { gestora, lead } = await setup();
    const esperaElas = await lead({ last: { direction: "out", body: "Temos horário amanhã" } });
    const esperaNos = await lead({ awaitingReplySince: ago(1), last: { direction: "in" } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "aguardando-cliente")).toEqual([esperaElas.id]);
    expect(all(q)).toContain(esperaNos.id);
    expect(ids(q, "aguardando-cliente")).not.toContain(esperaNos.id);
    expect(q.sections.at(-1)!.key).toBe("aguardando-cliente"); // a seção recolhida é a última
  });

  it("próximas ações de hoje: tarefa que vence até o fim do dia (Salvador), inclusive as vencidas", async () => {
    const { gestora, lead } = await setup();
    const hoje = await lead({ last: { direction: "out" } });
    const vencida = await lead({ last: { direction: "out" } });
    const amanha = await lead({ last: { direction: "out" } });
    const task = (d: { id: string; contactId: string }, dueAt: Date, title: string, kind = "proxima_acao") => db.insert(tasks).values({ dealId: d.id, contactId: d.contactId, kind, title, dueAt });
    await task(hoje, new Date("2026-10-07T22:30:00Z"), "Ligar às 19h30"); // 19h30 em Salvador
    await task(vencida, ago(60 * 24), "Retomar orçamento");
    await task(amanha, new Date("2026-10-08T12:00:00Z"), "Amanhã");
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "acoes-hoje").sort()).toEqual([hoje.id, vencida.id].sort());
    expect(ids(q, "aguardando-cliente")).toEqual([amanha.id]);
    const item = q.sections.find((s) => s.key === "acoes-hoje")!.items.find((i) => i.dealId === hoje.id)!;
    expect(item.nextAction).toMatchObject({ title: "Ligar às 19h30" });
    expect(new Date(item.nextAction!.dueAt).toISOString()).toBe("2026-10-07T22:30:00.000Z");
    expect(item.signals).not.toContain("Tarefa atrasada");
    expect(q.sections.find((s) => s.key === "acoes-hoje")!.items.find((i) => i.dealId === vencida.id)!.signals).toContain("Tarefa atrasada");
  });

  it("tarefa concluída não conta como próxima ação", async () => {
    const { gestora, lead } = await setup();
    const d = await lead({ stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    await db.insert(tasks).values({ dealId: d.id, contactId: d.contactId, kind: "proxima_acao", title: "Feita", dueAt: ago(10), doneAt: ago(5) });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "parados")).toEqual([d.id]);
    expect(q.sections.find((s) => s.key === "parados")!.items[0].nextAction).toBeUndefined();
  });
});

describe("getQueue: atrasados batem com o sino", () => {
  it("a seção atrasados tem os mesmos leads que countLateLeads conta, para cada papel", async () => {
    const { ana, bia, gestora, lead, lateAlert } = await setup();
    const da = await lead({ ownerId: ana.id, awaitingReplySince: ago(30) });
    const db_ = await lead({ ownerId: bia.id, awaitingReplySince: ago(30) });
    const sem = await lead({ ownerId: null, awaitingReplySince: ago(30) });
    const resolvido = await lead({ ownerId: ana.id, awaitingReplySince: ago(30) });
    const arq = await lead({ ownerId: ana.id, awaitingReplySince: ago(30), archivedAt: ago(1) });
    await lateAlert(da.id); await lateAlert(db_.id); await lateAlert(sem.id); await lateAlert(arq.id);
    await lateAlert(resolvido.id); await db.update(alerts).set({ resolvedAt: new Date() }).where(eq(alerts.dealId, resolvido.id));
    await db.insert(alerts).values({ dealId: da.id, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "nível 2", dedupeKey: "n2", waitKey: "espera:n2", level: 2 }); // nível 2 do mesmo lead conta uma vez
    await db.insert(alerts).values({ dealId: db_.id, audience: "responsavel", type: "tarefa_vencida", severity: "info", message: "t", dedupeKey: "t1", waitKey: "task:1" }); // tarefa não é atraso de resposta
    for (const u of [ana, bia, gestora]) {
      const q = await getQueue(asUser(u), { now: NOW });
      expect(ids(q, "atrasados").length).toBe(await countLateLeads(asUser(u)));
      expect(q.counts.atrasados).toBe(await countLateLeads(asUser(u)));
      // vindo de um relatório (filtro) a atendente vê só os dela, e o número é o da variante "só os dela"
      const f = await getQueue(asUser(u), { now: NOW, filtro: "atrasados" });
      expect(all(f).length).toBe(await countLateLeads(asUser(u), { onlyOwn: true }));
    }
    expect(ids(await getQueue(asUser(gestora), { now: NOW }), "atrasados")).toHaveLength(3);
  });

  it("lead sem dono atrasado aparece em Atrasados para a atendente e entra na contagem", async () => {
    const { ana, lead, lateAlert } = await setup();
    const sem = await lead({ ownerId: null, awaitingReplySince: ago(30) });
    await lateAlert(sem.id);
    const q = await getQueue(asUser(ana), { now: NOW });
    expect(ids(q, "atrasados")).toEqual([sem.id]);
    expect(q.counts.atrasados).toBe(1);
    expect(await countLateLeads(asUser(ana))).toBe(1);
  });
});

describe("getQueue: escopo, views e filtros", () => {
  it("atendente vê os leads dela e os sem dono; gestor vê todos", async () => {
    const { ana, bia, gestora, lead } = await setup();
    const minha = await lead({ ownerId: ana.id, awaitingReplySince: ago(1) });
    const sem = await lead({ ownerId: null, awaitingReplySince: ago(1) });
    const dela = await lead({ ownerId: bia.id, awaitingReplySince: ago(1) });
    expect(all(await getQueue(asUser(ana), { now: NOW })).sort()).toEqual([minha.id, sem.id].sort());
    expect(all(await getQueue(asUser(gestora), { now: NOW })).sort()).toEqual([minha.id, sem.id, dela.id].sort());
  });

  it("com filtro vindo de relatório, a atendente vê só os leads dela (como nos relatórios)", async () => {
    const { ana, lead } = await setup();
    const minha = await lead({ ownerId: ana.id, awaitingReplySince: ago(1) });
    await lead({ ownerId: null, awaitingReplySince: ago(1) });
    expect(all(await getQueue(asUser(ana), { now: NOW, filtro: "esperando" }))).toEqual([minha.id]);
  });

  it("views: meus, sem-dono, parados, agendados-hoje, clientes-ativos e sem-contato-90d", async () => {
    const { ana, gestora, lead } = await setup();
    const meu = await lead({ ownerId: ana.id, last: { direction: "out" } });
    const sem = await lead({ ownerId: null, last: { direction: "out" } });
    const parado = await lead({ ownerId: ana.id, stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    const agendado = await lead({ ownerId: ana.id, stage: "agendado", scheduledAt: new Date("2026-10-07T20:00:00Z"), last: { direction: "out" } }); // 17h em Salvador
    const amanha = await lead({ ownerId: ana.id, stage: "agendado", scheduledAt: new Date("2026-10-08T14:00:00Z"), last: { direction: "out" } });
    const cliente = await lead({ ownerId: ana.id, client: true, last: { direction: "out" } });
    const antigo = await lead({ ownerId: ana.id, createdAt: days(150), last: { direction: "out", at: days(120) } });
    const run = async (view: QueueView) => all(await getQueue(asUser(gestora), { now: NOW, view })).sort();
    expect(await run("meus")).toEqual([]); // a gestora não tem lead no nome dela
    expect(all(await getQueue(asUser(ana), { now: NOW, view: "meus" })).sort()).toEqual([meu.id, parado.id, agendado.id, amanha.id, cliente.id, antigo.id].sort());
    expect(await run("sem-dono")).toEqual([sem.id]);
    expect(await run("parados")).toEqual([parado.id]);
    expect(await run("agendados-hoje")).toEqual([agendado.id]);
    expect(await run("clientes-ativos")).toEqual([cliente.id]);
    expect(await run("sem-contato-90d")).toEqual([antigo.id]);
    expect(await run("todos")).toHaveLength(7);
  });

  it("filtros: esperando, parados (como nos relatórios), tarefas atrasadas, agendados de amanhã e novos", async () => {
    const { gestora, lead } = await setup();
    const espera = await lead({ awaitingReplySince: ago(5) });
    const parado = await lead({ stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    const paradoComAcao = await lead({ stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    await db.insert(tasks).values({ dealId: paradoComAcao.id, contactId: paradoComAcao.contactId, kind: "retorno", title: "Retorno", dueAt: ago(30) });
    const amanha = await lead({ stage: "agendado", scheduledAt: new Date("2026-10-08T14:00:00Z"), last: { direction: "out" } });
    const velho = await lead({ stage: "atendimento", createdAt: days(5), last: { direction: "out" } });
    const f = async (filtro: "esperando" | "parados" | "tarefas-atrasadas" | "agendados-amanha" | "novos", extra: { etapa?: string } = {}) => all(await getQueue(asUser(gestora), { now: NOW, filtro, ...extra })).sort();
    expect(await f("esperando")).toEqual([espera.id]);
    // "Parados" da tela de relatórios: passou do limite da etapa, tenha ou não uma tarefa marcada
    expect(await f("parados")).toEqual([parado.id, paradoComAcao.id].sort());
    expect(await f("parados", { etapa: "atendimento" })).toEqual([parado.id, paradoComAcao.id].sort());
    expect(await f("parados", { etapa: "lead" })).toEqual([]);
    expect(await f("tarefas-atrasadas")).toEqual([paradoComAcao.id]);
    expect(await f("agendados-amanha")).toEqual([amanha.id]);
    expect(await f("novos")).not.toContain(velho.id);
    expect((await f("novos")).length).toBe(5 - 1);
  });

  it("etapa (link da Jornada): só os leads daquela etapa; 'followup' junta os Follow-ups 1 a 4; etapa fechada não entra na Fila", async () => {
    const { gestora, ana, lead } = await setup();
    const novo = await lead({ awaitingReplySince: ago(5) });
    const atend = await lead({ stage: "atendimento", last: { direction: "out" } });
    const f1 = await lead({ stage: "followup_1", last: { direction: "out" } });
    const f3 = await lead({ stage: "followup_3", last: { direction: "out" } });
    const fechado = await lead({ stage: "fechado", closedAt: ago(10) });
    const etapa = async (e: string, user = gestora) => all(await getQueue(asUser(user), { now: NOW, etapa: e })).sort();
    expect(await etapa("lead")).toEqual([novo.id]);
    expect(await etapa("atendimento")).toEqual([atend.id]);
    expect(await etapa("followup_3")).toEqual([f3.id]);
    expect(await etapa("followup")).toEqual([f1.id, f3.id].sort());
    expect(await etapa("fechado")).toEqual([]);
    expect(fechado.id).toBeTruthy();
    // os números do resumo seguem a etapa; a atendente continua só no escopo dela (sem dono + os dela)
    expect((await getQueue(asUser(gestora), { now: NOW, etapa: "followup" })).counts.total).toBe(2);
    expect(await etapa("lead", ana as never)).toEqual([novo.id]);
    // chave estranha não vira erro: ignora o filtro
    expect((await etapa("x'; drop table deals;--")).length).toBe(4);
  });

  it("queueStageLabel dá o nome da etapa para o aviso da Fila; chave desconhecida vira null", async () => {
    expect(await queueStageLabel("lead")).toBe("Lead");
    expect(await queueStageLabel("followup")).toBe("Follow-up");
    expect(await queueStageLabel("nao_existe")).toBeNull();
    expect(await queueStageLabel(null)).toBeNull();
  });

  it("chips do resumo (foco): mesmo escopo e mesmo número dos counts, inclusive para a atendente", async () => {
    const { ana, bia, lead, lateAlert } = await setup();
    const minha = await lead({ ownerId: ana.id, awaitingReplySince: ago(30) });
    const sem = await lead({ ownerId: null, awaitingReplySince: ago(30) });
    await lead({ ownerId: bia.id, awaitingReplySince: ago(30) });
    const calma = await lead({ ownerId: ana.id, awaitingReplySince: ago(0.2) });
    await lead({ ownerId: ana.id, last: { direction: "out" } });
    await lateAlert(minha.id); await lateAlert(sem.id);
    const q = await getQueue(asUser(ana), { now: NOW });
    const aguardando = await getQueue(asUser(ana), { now: NOW, foco: "aguardando" });
    const atrasados = await getQueue(asUser(ana), { now: NOW, foco: "atrasados" });
    expect(all(aguardando)).toHaveLength(q.counts.aguardando);
    expect(all(aguardando).sort()).toEqual([minha.id, sem.id, calma.id].sort());
    expect(all(atrasados)).toHaveLength(q.counts.atrasados);
    expect(all(atrasados).sort()).toEqual([minha.id, sem.id].sort()); // com o sem dono, como no sino
    const hoje = await getQueue(asUser(ana), { now: NOW, view: "agendados-hoje" });
    expect(all(hoje)).toHaveLength(q.counts.agendadosHoje);
  });

  it("sem contato há 90 dias lista contatos para reengajar: último lead (aberto ou fechado), não arquivado, contato não ignorado", async () => {
    const { ana, gestora, lead } = await setup();
    const velhoFechado = await lead({ stage: "fechado", closedAt: days(100), createdAt: days(200), last: { direction: "out", at: days(120) } });
    const velhoAberto = await lead({ ownerId: ana.id, createdAt: days(150), last: { direction: "in", at: days(95) } });
    const semMensagem = await lead({ stage: "perdido", closedAt: days(100), createdAt: days(100) });
    await lead({ stage: "fechado", closedAt: days(10), last: { direction: "out", at: days(20) } }); // falou há 20 dias
    await lead({ stage: "fechado", closedAt: days(100), createdAt: days(200), archivedAt: days(1), last: { direction: "out", at: days(120) } }); // arquivado
    await lead({ stage: "fechado", closedAt: days(100), createdAt: days(200), ignored: true, last: { direction: "out", at: days(120) } }); // contato ignorado
    // contato com dois leads: vale o último, que é recente
    const antigo = await lead({ stage: "fechado", closedAt: days(300), createdAt: days(400), last: { direction: "out", at: days(300) } });
    await db.insert(deals).values({ contactId: antigo.contactId, stageId: antigo.stageId, createdAt: days(2), stageEnteredAt: days(2) });
    const q = await getQueue(asUser(gestora), { now: NOW, view: "sem-contato-90d" });
    expect(all(q).sort()).toEqual([velhoFechado.id, velhoAberto.id, semMensagem.id].sort());
    expect(q.sections.map((s) => s.key)).toEqual(["reengajar"]);
    expect(q.counts.views["sem-contato-90d"]).toBe(3);
    expect(all(await getQueue(asUser(gestora), { now: NOW }))).not.toContain(velhoFechado.id); // não polui a Fila principal
    // atendente: os dela e os sem dono
    const ana2 = await getQueue(asUser(ana), { now: NOW, view: "sem-contato-90d" });
    expect(all(ana2).sort()).toEqual([velhoFechado.id, velhoAberto.id, semMensagem.id].sort());
    expect(q.sections[0].items.find((i) => i.dealId === velhoFechado.id)).toMatchObject({ stageKey: "fechado", awaitingSince: null });
  });

  it("limite de leads mostrados: counts valem para todos e vem o aviso de corte", async () => {
    const { gestora, lead } = await setup();
    for (let i = 0; i < 5; i++) await lead({ awaitingReplySince: ago(1 + i) });
    const q = await getQueue(asUser(gestora), { now: NOW, limit: 3 });
    expect(all(q)).toHaveLength(3);
    expect(q.truncated).toEqual({ shown: 3, total: 5 });
    expect(q.counts.total).toBe(5);
    expect(q.counts.aguardando).toBe(5);
    expect((await getQueue(asUser(gestora), { now: NOW })).truncated).toBeNull();
  });

  it("nextWaitingId: quem espera há mais tempo no escopo, sem o lead atual", async () => {
    const { ana, bia, lead } = await setup();
    const a = await lead({ ownerId: ana.id, awaitingReplySince: ago(5) });
    const b = await lead({ ownerId: null, awaitingReplySince: ago(9) });
    await lead({ ownerId: bia.id, awaitingReplySince: ago(20) });
    expect(await nextWaitingId(asUser(ana), a.id)).toBe(b.id);
    expect(await nextWaitingId(asUser(ana), b.id)).toBe(a.id);
    expect(await nextWaitingId(asUser(ana), "00000000-0000-4000-8000-000000000000")).toBe(b.id);
  });

  it("busca por nome e por telefone; contagens do resumo ignoram a busca", async () => {
    const { gestora, lead } = await setup();
    const maria = await lead({ awaitingReplySince: ago(1) });
    await db.update(contacts).set({ name: "Maria Souza" }).where(eq(contacts.id, maria.contactId));
    await lead({ awaitingReplySince: ago(1) });
    const q = await getQueue(asUser(gestora), { now: NOW, q: "maria" });
    expect(all(q)).toEqual([maria.id]);
    expect(q.counts.total).toBe(2);
    expect(all(await getQueue(asUser(gestora), { now: NOW, q: "5571999900" }))).toHaveLength(2);
  });

  it("o item traz tudo que a linha mostra", async () => {
    const { ana, gestora, lead } = await setup();
    const d = await lead({ ownerId: ana.id, awaitingReplySince: ago(1), origin: "Instagram", client: true, last: { direction: "in", body: "Quanto custa a hidratação?" } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(q.sections[0].items[0]).toMatchObject({
      dealId: d.id, contactId: d.contactId, name: "Cliente 1", phone: "+557199990001", hasAvatar: false, slaMinutes: 2,
      lastMessage: "Quanto custa a hidratação?", lastKind: "text", lastDirection: "in", stageKey: "lead", stageName: "Lead", sourceLabel: "Instagram", ownerName: "Ana",
    });
    expect(q.sections[0].items[0].awaitingSince).toBe(ago(1).toISOString());
    expect(q.sections[0].items[0].signals).toContain("Cliente");
  });
});

describe("getQueueItem: o item de um lead só, com as mesmas exclusões da Fila", () => {
  it("devolve nome, espera e última mensagem de um lead aberto", async () => {
    const { lead } = await setup();
    const l = await lead({ awaitingReplySince: ago(3), last: { direction: "in", body: "Oi, tem horário?" } });
    const item = await getQueueItem(l.id);
    expect(item).toMatchObject({ dealId: l.id, name: expect.stringContaining("Cliente"), lastMessage: "Oi, tem horário?", lastDirection: "in", stageKey: "lead" });
    expect(item!.awaitingSince).not.toBeNull();
  });
  it("não devolve lead arquivado, contato ignorado, id inválido nem lead que não existe", async () => {
    const { lead } = await setup();
    const arq = await lead({ archivedAt: ago(5) });
    const ign = await lead({ ignored: true });
    expect(await getQueueItem(arq.id)).toBeNull();
    expect(await getQueueItem(ign.id)).toBeNull();
    expect(await getQueueItem("nao-e-uuid")).toBeNull();
    expect(await getQueueItem("00000000-0000-4000-8000-000000000001")).toBeNull();
  });
});
