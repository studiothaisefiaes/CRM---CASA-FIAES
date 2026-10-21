import { beforeEach, describe, expect, it } from "vitest";
import { permsFor } from "../../../test/perms";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, appointments, contacts, deals, messages, settings, stages, tasks, teams, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { countLateLeads } from "./late-count";
import { attendanceDue, getQueue, getQueueItem, nextWaitingId, queueStageLabel, type QueueResult } from "./queue";
import type { QueueView } from "../../lib/queue";
import { addTag, setTagColor } from "../domain/tags";

beforeEach(async () => { await resetDb(); });

// Quarta-feira 15:00 em Salvador (18:00Z): dentro do expediente padrão (seg–sex 8–20), então a espera conta minuto a minuto.
const NOW = new Date("2026-10-07T18:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);
const days = (d: number) => new Date(NOW.getTime() - d * 86_400_000);
const asUser = (u: { id: string; name: string; email: string; role: "gestor" | "atendente" }) => ({ id: u.id, name: u.name, email: u.email, perms: permsFor(u.role) });

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
  it("quem espera, na ordem do WhatsApp: a mensagem mais nova primeiro, atrasada ou não (a Cati, 16/10)", async () => {
    const { gestora, lead, lateAlert } = await setup();
    const aguardando = await lead({ awaitingReplySince: ago(0.4) }); // Lead tem prazo de 2 min: 0,4 min é 20% do prazo
    const perto = await lead({ awaitingReplySince: ago(1.3) }); // 65% do prazo
    const atrasado = await lead({ awaitingReplySince: ago(30) });
    const atrasado2 = await lead({ awaitingReplySince: ago(45) });
    await lateAlert(atrasado.id); await lateAlert(atrasado2.id);
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(keys(q)).toEqual(["aguardando", "perto", "atrasados"]);
    expect(ids(q, "atrasados")).toEqual([atrasado.id, atrasado2.id]);
    expect(ids(q, "perto")).toEqual([perto.id]);
    expect(ids(q, "aguardando")).toEqual([aguardando.id]);
  });

  it("passou do prazo sem alerta ainda: já entra em Atrasados (não existe 'Prazo estourado'); só quem tem alerta é vermelho", async () => {
    const { gestora, lead, lateAlert } = await setup();
    const perto = await lead({ awaitingReplySince: ago(1.3) }); // 65% do prazo de 2 min
    const estourado = await lead({ awaitingReplySince: ago(5) }); // passou do prazo; o motor ainda não gerou o alerta
    const atrasado = await lead({ awaitingReplySince: ago(30) });
    await lateAlert(atrasado.id);
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(keys(q)).toEqual(["perto", "atrasados"]);
    expect(ids(q, "atrasados")).toEqual([estourado.id, atrasado.id]);
    expect(ids(q, "perto")).toEqual([perto.id]);
    expect(q.sections.find((s) => s.key === "atrasados")!.items.map((i) => !!i.alert)).toEqual([false, true]); // estourado (sem alerta) é o mais novo
    expect(q.counts.atrasados).toBe(2);
    expect(await countLateLeads(asUser(gestora))).toBe(1); // o sino conta só alerta; a diferença dura até o próximo ciclo do motor
  });

  it("canal em modo quieto: lead além do prazo não aparece como estourado nem atrasado (o modo quieto suspende os avisos)", async () => {
    const { gestora, lead } = await setup();
    const { channels } = await import("../db/schema");
    const [ch] = await db.insert(channels).values({ name: "Rec", instanceName: "rec-q", status: "conectado", quietUntil: new Date(NOW.getTime() + 3_600_000) }).returning();
    const quieto = await lead({ awaitingReplySince: ago(30), channelId: ch.id });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(keys(q)).toEqual(["aguardando"]);
    expect(ids(q, "aguardando")).toEqual([quieto.id]);
  });

  it("quase no prazo é a partir de 60% do prazo da etapa, contado só no expediente; a seção diz quantos minutos faltam", async () => {
    const { gestora, lead } = await setup();
    const abaixo = await lead({ awaitingReplySince: ago(1.1) }); // 55% de 2 min
    const acima = await lead({ awaitingReplySince: ago(1.3) }); // 65%: faltam 42 s
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "aguardando")).toEqual([abaixo.id]);
    expect(ids(q, "perto")).toEqual([acima.id]);
    expect(q.sections.find((s) => s.key === "perto")!.n).toBe(1);
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
    const sec = q.sections.find((s) => s.key === "parados")!;
    expect(sec.items[0].stoppedDays).toBe(2); // domingo 15h → quarta 15h: o domingo (fechado no horário padrão) não conta
    expect(sec.n).toBe(2);
  });

  it("parado não conta os dias com a Casa fechada (igual ao motor): Em conversa de sábado 17h não está parada na terça 9:30", async () => {
    const win: [string, string] = ["09:00", "18:00"];
    await db.insert(settings).values({ key: "business_hours", value: { 0: null, 1: null, 2: win, 3: win, 4: win, 5: win, 6: win } });
    const { gestora, lead } = await setup();
    const sab = new Date("2026-10-17T20:00:00Z");
    const d = await lead({ stage: "atendimento", stageEnteredAt: sab, last: { direction: "out", at: sab } });
    let q = await getQueue(asUser(gestora), { now: new Date("2026-10-20T12:30:00Z") });
    expect(ids(q, "parados")).toEqual([]);
    q = await getQueue(asUser(gestora), { now: new Date("2026-10-21T20:01:00Z") }); // quarta 17:01: 2 dias de Casa aberta
    expect(ids(q, "parados")).toEqual([d.id]);
    expect(q.sections.find((s) => s.key === "parados")!.items[0].stoppedDays).toBe(2);
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
    expect(item.signals).toEqual([]);
    expect(item.badges ?? []).not.toContain("Tarefa atrasada"); // o "venceu" já está no texto da linha
  });

  it("tarefa concluída não conta como próxima ação", async () => {
    const { gestora, lead } = await setup();
    const d = await lead({ stage: "atendimento", stageEnteredAt: days(3), last: { direction: "out" } });
    await db.insert(tasks).values({ dealId: d.id, contactId: d.contactId, kind: "proxima_acao", title: "Feita", dueAt: ago(10), doneAt: ago(5) });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(ids(q, "parados")).toEqual([d.id]);
    expect(q.sections.find((s) => s.key === "parados")!.items[0].nextAction).toBeUndefined();
  });

  it("foco 'combinados' (resumo: combinados vencidos) mostra só quem tem tarefa vencida", async () => {
    const { gestora, lead } = await setup();
    const vencida = await lead({ last: { direction: "out" } });
    const futura = await lead({ last: { direction: "out" } });
    await db.insert(tasks).values([
      { dealId: vencida.id, contactId: vencida.contactId, kind: "proxima_acao", title: "Retomar", dueAt: ago(60 * 26) },
      { dealId: futura.id, contactId: futura.contactId, kind: "proxima_acao", title: "Depois", dueAt: new Date(NOW.getTime() + 86_400_000) },
    ]);
    const q = await getQueue(asUser(gestora), { now: NOW, foco: "combinados" });
    expect(all(q)).toEqual([vencida.id]);
    expect(q.counts.tarefasAtrasadas).toBe(1);
  });

  it("foco 'retomar' (aba Para retomar): a Casa já respondeu e há combinado com data; não some e não entra quem espera a Casa (20/10)", async () => {
    const { gestora, lead } = await setup();
    const retomar = await lead({ last: { direction: "out" } });
    const esperando = await lead({ awaitingReplySince: ago(30) });
    const semCombinado = await lead({ last: { direction: "out" } });
    await db.insert(tasks).values([
      { dealId: retomar.id, contactId: retomar.contactId, kind: "proxima_acao", title: "Falar de novo", dueAt: new Date(NOW.getTime() + 3 * 86_400_000) },
      { dealId: esperando.id, contactId: esperando.contactId, kind: "proxima_acao", title: "Outro", dueAt: new Date(NOW.getTime() + 86_400_000) },
    ]);
    const q = await getQueue(asUser(gestora), { now: NOW, foco: "retomar" });
    expect(all(q)).toEqual([retomar.id]);
    expect(q.counts.retomar).toBe(1);
    expect(all(await getQueue(asUser(gestora), { now: NOW })).sort()).toEqual([retomar.id, esperando.id, semCombinado.id].sort()); // continua em Todas
  });

  it("Para retomar: combinado vencido com conversa depois sai da aba (Luciana, 20/10)", async () => {
    const { gestora, lead } = await setup();
    const conversou = await lead({ last: { direction: "out", at: ago(10) } });
    const parada = await lead({ last: { direction: "out", at: new Date(NOW.getTime() - 5 * 86_400_000) } });
    const venceu = new Date(NOW.getTime() - 2 * 86_400_000);
    await db.insert(tasks).values([
      { dealId: conversou.id, contactId: conversou.contactId, kind: "proxima_acao", title: "Pós-atendimento", dueAt: venceu },
      { dealId: parada.id, contactId: parada.contactId, kind: "proxima_acao", title: "Pós-atendimento", dueAt: venceu },
    ]);
    const q = await getQueue(asUser(gestora), { now: NOW, foco: "retomar" });
    expect(all(q)).toEqual([parada.id]);
    expect(q.counts.retomar).toBe(1);
  });

  it("aba Esperando: só quem espera a Casa, a espera mais antiga primeiro (a Todas segue a ordem do WhatsApp) (20/10)", async () => {
    const { gestora, lead } = await setup();
    const nova = await lead({ awaitingReplySince: ago(5), last: { direction: "in", at: ago(5) } });
    const antiga = await lead({ awaitingReplySince: ago(180), last: { direction: "in", at: ago(180) } });
    await lead({ last: { direction: "out" } });
    expect(all(await getQueue(asUser(gestora), { now: NOW, foco: "aguardando" }))).toEqual([antiga.id, nova.id]);
  });

  it("aba Todas é literalmente todas: as resolvidas entram na mesma lista; Esperando e Não lidas não (20/10)", async () => {
    const { gestora, lead } = await setup();
    const aberta = await lead({ awaitingReplySince: ago(5), last: { direction: "in", at: ago(5) } });
    const resolvida = await lead({ conversationArchivedAt: ago(60), last: { direction: "out", at: ago(70) } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(all(q).sort()).toEqual([aberta.id, resolvida.id].sort());
    expect(q.counts.todasTotal).toBe(2);
    expect(all(await getQueue(asUser(gestora), { now: NOW, foco: "aguardando" }))).toEqual([aberta.id]);
  });

  it("com 'Minhas' ligado, os números das abas contam só as dela (20/10: 'Esperando 3' e a lista vazia)", async () => {
    const { ana, bia, lead } = await setup();
    await lead({ ownerId: bia.id, awaitingReplySince: ago(5), last: { direction: "in", at: ago(5) } });
    const minha = await lead({ ownerId: ana.id, awaitingReplySince: ago(9), last: { direction: "in", at: ago(9) } });
    const q = await getQueue(asUser(ana), { now: NOW, view: "meus" });
    expect(q.counts.aguardando).toBe(1);
    expect(all(await getQueue(asUser(ana), { now: NOW, view: "meus", foco: "aguardando" }))).toEqual([minha.id]);
  });

  it("Para retomar pega também a resolvida que tem retomada aberta (caso Aline, 20/10), a data mais próxima primeiro", async () => {
    const { gestora, lead } = await setup();
    const resolvida = await lead({ conversationArchivedAt: ago(30), last: { direction: "out", at: ago(40) } });
    const aberta = await lead({ last: { direction: "out" } });
    await db.insert(tasks).values([
      { dealId: resolvida.id, contactId: resolvida.contactId, kind: "proxima_acao", title: "Retomar em novembro", dueAt: new Date(NOW.getTime() + 30 * 86_400_000) },
      { dealId: aberta.id, contactId: aberta.contactId, kind: "proxima_acao", title: "Amanhã", dueAt: new Date(NOW.getTime() + 86_400_000) },
    ]);
    const q = await getQueue(asUser(gestora), { now: NOW, foco: "retomar" });
    expect(all(q)).toEqual([aberta.id, resolvida.id]);
    expect(q.counts.retomar).toBe(2);
  });

  it("nextWaitingId pula conversa encerrada", async () => {
    const { ana, lead } = await setup();
    const a = await lead({ ownerId: ana.id, awaitingReplySince: ago(5) });
    await lead({ ownerId: ana.id, awaitingReplySince: ago(30), conversationArchivedAt: ago(1) });
    expect(await nextWaitingId(asUser(ana), "00000000-0000-4000-8000-000000000000")).toBe(a.id);
  });
});

describe("getQueue: atrasados batem com o sino", () => {
  it("a seção atrasados tem os mesmos leads que countLateLeads conta, para cada papel", async () => {
    const { ana, bia, gestora, lead, lateAlert } = await setup();
    const da = await lead({ ownerId: ana.id, awaitingReplySince: ago(30) });
    const db_ = await lead({ ownerId: bia.id, awaitingReplySince: ago(30) });
    const sem = await lead({ ownerId: null, awaitingReplySince: ago(30) });
    const resolvido = await lead({ ownerId: ana.id, awaitingReplySince: null, last: { direction: "out" } }); // alguém respondeu: o alerta foi resolvido (esperando além do prazo, entraria em Atrasados pelo prazo)
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
    expect(await queueStageLabel("lead")).toBe("Novo contato");
    expect(await queueStageLabel("followup")).toBe("Aguardando cliente");
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

  it("telefone em qualquer formato: com ou sem +55, DDD, máscara e o 9 da frente (também na lista das Encerradas)", async () => {
    const { gestora, lead } = await setup();
    const a = await lead({ awaitingReplySince: ago(1) });
    await db.update(contacts).set({ phoneE164: "+5571990000004" }).where(eq(contacts.id, a.contactId));
    const b = await lead({ awaitingReplySince: ago(1), conversationArchivedAt: ago(1) });
    await db.update(contacts).set({ phoneE164: "+557187650004" }).where(eq(contacts.id, b.contactId)); // guardado sem o 9
    for (const q of ["90000004", "71 99000-0004", "(71) 9000-0004", "+55 71 9 9000 0004", "071 99000-0004"]) expect(all(await getQueue(asUser(gestora), { now: NOW, q }))).toEqual([a.id]);
    expect(all(await getQueue(asUser(gestora), { now: NOW, view: "arquivadas", q: "71 98765-0004" }))).toEqual([b.id]);
  });

  it("busca encontra palavras da transcrição do áudio; prévia traz duração e transcrição", async () => {
    const { gestora, lead } = await setup();
    const voz = await lead({ awaitingReplySince: ago(1), last: { direction: "in", kind: "audio", body: "" } });
    await db.update(messages).set({ body: null, mediaDurationSec: 42, transcript: "Queria marcar uma Progressiva para sábado", transcriptStatus: "pronta" }).where(eq(messages.dealId, voz.id));
    await lead({ awaitingReplySince: ago(1), last: { direction: "in", body: "oi" } });
    const q = await getQueue(asUser(gestora), { now: NOW, q: "progressiva" });
    expect(all(q)).toEqual([voz.id]);
    const item = q.sections.flatMap((s) => s.items)[0];
    expect(item).toMatchObject({ lastKind: "audio", lastDurationSec: 42, lastTranscript: "Queria marcar uma Progressiva para sábado" });
    // arquivada: a busca também olha a transcrição
    await db.update(deals).set({ conversationArchivedAt: ago(1) }).where(eq(deals.id, voz.id));
    expect(all(await getQueue(asUser(gestora), { now: NOW, view: "arquivadas" as QueueView, q: "progressiva" }))).toEqual([voz.id]);
  });

  it("busca encontra palavras das mensagens (o campo diz 'Buscar nome, telefone ou mensagem')", async () => {
    const { gestora, lead } = await setup();
    const msg = await lead({ awaitingReplySince: ago(1), last: { direction: "in", body: "Vocês fazem mega hair?" } });
    await lead({ awaitingReplySince: ago(1), last: { direction: "in", body: "oi" } });
    expect(all(await getQueue(asUser(gestora), { now: NOW, q: "mega hair" }))).toEqual([msg.id]);
  });

  it("o item traz tudo que a linha mostra", async () => {
    const { ana, gestora, lead } = await setup();
    const d = await lead({ ownerId: ana.id, awaitingReplySince: ago(1), origin: "Instagram", client: true, last: { direction: "in", body: "Quanto custa a hidratação?" } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(q.sections[0].items[0]).toMatchObject({
      dealId: d.id, contactId: d.contactId, name: "Cliente 1", phone: "+557199990001", hasAvatar: false, slaMinutes: 2,
      lastMessage: "Quanto custa a hidratação?", lastKind: "text", lastDirection: "in", stageKey: "lead", stageName: "Novo contato", stageKind: "lead", sourceLabel: "Instagram", ownerName: "Ana",
    });
    expect(q.sections[0].items[0].awaitingSince).toBe(ago(1).toISOString());
    const it0 = q.sections[0].items[0];
    expect(it0.badges ?? []).not.toContain("Cliente"); // "Cliente" mora no painel, não na linha
    expect(it0.signals).not.toContain("Sem dono");
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

describe("getQueue: etiquetas de sinal", () => {
  it("mostra as etiquetas pelas últimas mensagens, no máximo 2 por item", async () => {
    const { gestora, lead } = await setup();
    const d = await lead({ awaitingReplySince: ago(5) });
    const ins = (direction: "in" | "out", body: string, at: Date) => db.insert(messages).values({ dealId: d.id, contactId: d.contactId, direction, body, kind: "text", createdAt: at });
    await ins("in", "Quanto custa? E tem horário sábado?", ago(30)); await ins("out", "Fica R$ 150", ago(29)); await ins("in", "Ok", ago(5));
    const q = await getQueue(asUser(gestora), { now: NOW });
    const item = q.sections.flatMap((s) => s.items).find((i) => i.dealId === d.id)!;
    const sinais = item.signals.filter((s) => ["Pediu preço", "Pediu horário", "Sumiu após preço"].includes(s));
    expect(sinais).toEqual(["Pediu horário"]); // a Casa mandou o valor: "Pediu preço" some; horário ninguém ofereceu
  });
  it("sumiu depois do preço aparece primeiro", async () => {
    const { gestora, lead } = await setup();
    const d = await lead({ awaitingReplySince: null, last: { direction: "out", body: "O valor é R$ 90", at: days(3) } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    expect(q.sections.flatMap((s) => s.items).find((i) => i.dealId === d.id)!.signals).toContain("Sumiu após preço");
  });
});

describe("quem respondeu", () => {
  it("traz quem escreveu a última mensagem e 'respondida por' quando não é a dona", async () => {
    const { ana, bia, gestora, lead } = await setup();
    await db.update(users).set({ signature: "BIBI" }).where(eq(users.id, bia.id));
    const d = await lead({ ownerId: ana.id, lastReplyById: bia.id, lastReplyVia: "celular" });
    await db.insert(messages).values({ dealId: d.id, contactId: d.contactId, direction: "out", body: "*BIBI - CASA FIAES:*\nOi", sentByUserId: bia.id, sentVia: "celular", fromPhone: true, createdAt: ago(1) });
    const own = await lead({ ownerId: ana.id, lastReplyById: ana.id, last: { direction: "out" } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    const items = q.sections.flatMap((s) => s.items);
    expect(items.find((i) => i.dealId === d.id)).toMatchObject({ ownerShort: "Ana", lastAuthorName: "Bibi", repliedByName: "Bibi" });
    expect(items.find((i) => i.dealId === own.id)).toMatchObject({ lastAuthorName: null, repliedByName: null });
    expect(await getQueueItem(d.id)).toMatchObject({ lastAuthorName: "Bibi", repliedByName: "Bibi", lastSentVia: "celular" });
    expect(items.find((i) => i.dealId === d.id)).toMatchObject({ lastSentVia: "celular" });
  });
});

describe("getQueue: cor das etiquetas (Lote 4)", () => {
  it("o item traz a cor de cada etiqueta que tem cor; sem cor, não aparece em tagColors", async () => {
    const { gestora, lead } = await setup();
    const d = await lead({ awaitingReplySince: ago(0.4) });
    const vip = await addTag(d.contactId, "VIP", gestora.id);
    await addTag(d.contactId, "Noiva", gestora.id);
    await setTagColor(vip.id, "#2f6b4f", gestora.id);
    const item = (await getQueue(asUser(gestora), { now: NOW })).sections.flatMap((s) => s.items).find((i) => i.dealId === d.id)!;
    expect(item.tags).toEqual(["Noiva", "VIP"]);
    expect(item.tagColors).toEqual({ VIP: "#2f6b4f" });
  });
});

describe("filtro por etiqueta (Lote 4)", () => {
  it("só as conversas de clientes com a etiqueta, e os números do resumo seguem o filtro", async () => {
    const { gestora, lead } = await setup();
    const a = await lead({ awaitingReplySince: ago(2), last: { direction: "in" } });
    await lead({ awaitingReplySince: ago(3), last: { direction: "in" } });
    const noiva = await addTag(a.contactId, "Noiva", gestora.id);
    const q = await getQueue(asUser(gestora), { etiqueta: noiva.id, now: NOW });
    expect(q.sections.flatMap((s) => s.items.map((i) => i.dealId))).toEqual([a.id]);
    expect(q.counts.total).toBe(1);
    expect((await getQueue(asUser(gestora), { now: NOW })).counts.total).toBe(2);
  });
  it("etiqueta que não é id (link velho, digitado) é ignorada sem erro", async () => {
    const { gestora, lead } = await setup();
    await lead({ awaitingReplySince: ago(2), last: { direction: "in" } });
    expect((await getQueue(asUser(gestora), { etiqueta: "vip", now: NOW })).counts.total).toBe(1);
  });
});

describe("filtros finos da Fila (Fase B)", () => {
  const ids = (q: QueueResult) => q.sections.flatMap((s) => s.items.map((i) => i.dealId)).sort();
  async function tagged() {
    const { gestora, ana, lead } = await setup();
    const mk = (over = {}) => lead({ awaitingReplySince: ago(2), last: { direction: "in", at: ago(2) }, ...over });
    const a = await mk(), b = await mk(), c = await mk(), d = await mk();
    const metodo = await addTag(a.contactId, "Método", gestora.id); await addTag(b.contactId, "Método", gestora.id); await addTag(c.contactId, "Método", gestora.id);
    const horario = await addTag(a.contactId, "Horário marcado", gestora.id); await addTag(d.contactId, "Horário marcado", gestora.id);
    const noiva = await addTag(b.contactId, "Noiva", gestora.id);
    return { gestora, ana, lead, a, b, c, d, metodo, horario, noiva };
  }
  it("Todas: só quem tem as duas etiquetas", async () => {
    const t = await tagged();
    const q = await getQueue(asUser(t.gestora), { etiquetas: [t.metodo.id, t.horario.id], regraEtiqueta: "todas", now: NOW });
    expect(ids(q)).toEqual([t.a.id]);
  });
  it("Qualquer: quem tem uma ou outra (é o padrão)", async () => {
    const t = await tagged();
    const q = await getQueue(asUser(t.gestora), { etiquetas: [t.horario.id, t.noiva.id], now: NOW });
    expect(ids(q)).toEqual([t.a.id, t.b.id, t.d.id].sort());
  });
  it("Não tem: 'Método sem Horário marcado' = a etiqueta Método e não tem Horário marcado (combina as duas listas)", async () => {
    const t = await tagged();
    const q = await getQueue(asUser(t.gestora), { etiqueta: t.metodo.id, etiquetas: [t.horario.id], regraEtiqueta: "nao_tem", now: NOW });
    expect(ids(q)).toEqual([t.b.id, t.c.id].sort());
    // Sozinha, "Não tem" também vale: quem não tem Horário marcado.
    expect(ids(await getQueue(asUser(t.gestora), { etiquetas: [t.horario.id], regraEtiqueta: "nao_tem", now: NOW }))).toEqual([t.b.id, t.c.id].sort());
  });
  it("link antigo ?etiqueta=<id> continua funcionando; ids que não são uuid são ignorados", async () => {
    const t = await tagged();
    expect(ids(await getQueue(asUser(t.gestora), { etiqueta: t.noiva.id, now: NOW }))).toEqual([t.b.id]);
    expect(ids(await getQueue(asUser(t.gestora), { etiquetas: ["vip", t.noiva.id], now: NOW }))).toEqual([t.b.id]);
    expect((await getQueue(asUser(t.gestora), { etiquetas: ["vip"], now: NOW })).counts.total).toBe(4);
  });
  it("dono=sem combinado com etapa e etiqueta; funciona para a atendente também", async () => {
    const t = await tagged();
    await db.update(deals).set({ ownerId: t.ana.id }).where(eq(deals.id, t.a.id));
    const q = await getQueue(asUser(t.gestora), { dono: "sem", etiqueta: t.metodo.id, etapa: "lead", now: NOW });
    expect(ids(q)).toEqual([t.b.id, t.c.id].sort());
    expect(ids(await getQueue(asUser(t.ana), { dono: "sem", now: NOW }))).toEqual([t.b.id, t.c.id, t.d.id].sort());
  });
  it("dias sem conversar = 30 conta a última mensagem de qualquer lado", async () => {
    const { gestora, lead } = await setup();
    const velha = await lead({ last: { direction: "out", at: days(40) } });
    await lead({ last: { direction: "in", at: days(10) } });
    const mista = await lead({ last: { direction: "in", at: days(60) } });
    await db.insert(messages).values({ dealId: mista.id, contactId: mista.contactId, direction: "out", body: "oi", kind: "text", createdAt: days(2) });
    await lead({});
    const q = await getQueue(asUser(gestora), { diasSemConversa: 30, now: NOW });
    expect(ids(q)).toEqual([velha.id]);
  });
});

describe("filtro por setor (Setores)", () => {
  it("filtro setor mostra só as conversas do setor, e id que não é uuid é ignorado", async () => {
    const { gestora, lead } = await setup();
    const [rec] = await db.select().from(teams).where(eq(teams.name, "Recepção"));
    const a = await lead({ awaitingReplySince: ago(2), last: { direction: "in" }, teamId: rec.id });
    await lead({ awaitingReplySince: ago(3), last: { direction: "in" } });
    const q = await getQueue(asUser(gestora), { setor: rec.id, now: NOW });
    expect(q.sections.flatMap((s) => s.items.map((i) => i.dealId))).toEqual([a.id]);
    expect(q.counts.total).toBe(1);
    expect((await getQueue(asUser(gestora), { setor: "recepcao", now: NOW })).counts.total).toBe(2);
  });
});

describe("Não lidas (Atendimento no desenho aprovado)", () => {
  it("conta as mensagens da cliente depois da última abertura, da última resposta e do Resolvido; a aba Não lidas mostra só essas", async () => {
    const { gestora, lead } = await setup();
    const nova = await lead({ awaitingReplySince: ago(9), last: { direction: "in", at: ago(9) } });
    await db.insert(messages).values({ dealId: nova.id, contactId: nova.contactId, direction: "in", body: "tem horário?", kind: "text", createdAt: ago(5) });
    const vista = await lead({ awaitingReplySince: ago(9), seenAt: ago(2), last: { direction: "in", at: ago(9) } });
    const respondida = await lead({ lastOutboundAt: ago(3), last: { direction: "in", at: ago(9) } });
    const resolvida = await lead({ resolvedAt: ago(3), last: { direction: "in", at: ago(9) } });
    const q = await getQueue(asUser(gestora), { now: NOW });
    const item = (id: string) => q.sections.flatMap((s) => s.items).find((i) => i.dealId === id)!;
    expect(item(nova.id).unread).toBe(2);
    expect([vista, respondida, resolvida].map((d) => item(d.id).unread ?? 0)).toEqual([0, 0, 0]);
    expect(q.counts.naoLidas).toBe(1);
    expect(all(await getQueue(asUser(gestora), { now: NOW, aba: "nao-lidas" }))).toEqual([nova.id]);
    // O número das abas não muda com a aba escolhida.
    expect((await getQueue(asUser(gestora), { now: NOW, aba: "nao-lidas" })).counts.views.todos).toBe(4);
  });

  it("mensagem da cliente sem resposta sobe para o topo em qualquer etapa (atrasadas, depois a mais nova); abrir não tira do lugar", async () => {
    const { gestora, lead, lateAlert } = await setup();
    const atrasadaVista = await lead({ awaitingReplySince: ago(30), seenAt: ago(1), last: { direction: "in", at: ago(30) } });
    await lateAlert(atrasadaVista.id);
    const agendada = await lead({ stage: "agendado", lastOutboundAt: ago(20), last: { direction: "in", at: ago(2), body: "posso atrasar 10 min?" } });
    const naCasa = await lead({ stage: "na_casa", lastOutboundAt: ago(20), last: { direction: "in", at: ago(5) } });
    const semNada = await lead({ stage: "atendimento", lastOutboundAt: ago(3), last: { direction: "out", at: ago(3) } });
    // ordem do WhatsApp: a mais nova primeiro; a atrasada (mesmo já vista) continua no bloco de quem espera
    expect(all(await getQueue(asUser(gestora), { now: NOW }))).toEqual([agendada.id, semNada.id, naCasa.id, atrasadaVista.id]);
  });

  it("mensagem automática depois da cliente não derruba quem espera resposta; no topo, as atrasadas primeiro e depois a mais nova", async () => {
    const { gestora, lead, lateAlert } = await setup();
    // Ela escreveu e a resposta automática (fora do horário) saiu depois: a última é "out", mas a espera continua.
    // Etapa Atendida (prazo de 15 min): as duas ainda no prazo.
    const comAuto = await lead({ stage: "atendida", awaitingReplySince: ago(4), last: { direction: "out", at: ago(3), body: "Estamos fora do horário" } });
    const nova = await lead({ stage: "atendida", awaitingReplySince: ago(2), last: { direction: "in", at: ago(2) } });
    const atrasada = await lead({ awaitingReplySince: ago(40), last: { direction: "in", at: ago(40) } });
    await lateAlert(atrasada.id);
    const respondida = await lead({ lastOutboundAt: ago(1), last: { direction: "out", at: ago(1) } });
    expect(all(await getQueue(asUser(gestora), { now: NOW }))).toEqual([respondida.id, nova.id, comAuto.id, atrasada.id]); // a lista toda pela última mensagem (17/10)
  });

  it("encerrada em que a cliente só agradeceu continua encerrada, mas aparece em Todas e Não lidas até alguém abrir", async () => {
    const { gestora, lead } = await setup();
    const enc = await lead({ stage: "atendida", lastOutboundAt: ago(20), conversationArchivedAt: ago(10), lastInboundAt: ago(2), last: { direction: "in", at: ago(2), body: "Obrigada!" } });
    const velha = await lead({ stage: "atendida", lastOutboundAt: ago(20), conversationArchivedAt: ago(10), lastInboundAt: ago(30), last: { direction: "in", at: ago(30) } });
    let q = await getQueue(asUser(gestora), { now: NOW });
    expect(all(q)).toEqual([enc.id, velha.id]); // Todas = literalmente todas (20/10); a que tem mensagem nova vem antes
    expect(q.counts.naoLidas).toBe(1);
    expect(q.counts.views.arquivadas).toBe(2);
    expect(all(await getQueue(asUser(gestora), { now: NOW, aba: "nao-lidas" }))).toEqual([enc.id]);
    await db.update(deals).set({ seenAt: ago(0) }).where(eq(deals.id, enc.id));
    q = await getQueue(asUser(gestora), { now: NOW, aba: "nao-lidas" });
    expect(all(q)).toEqual([]);
    expect(all(await getQueue(asUser(gestora), { now: NOW, view: "arquivadas" })).sort()).toEqual([enc.id, velha.id].sort());
  });

  it("Dona (painel Filtros): a gestão filtra pela dona sem precisar de link de relatório; a atendente não filtra pelas outras", async () => {
    const { ana, bia, gestora, lead } = await setup();
    const daAna = await lead({ ownerId: ana.id, awaitingReplySince: ago(1) });
    await lead({ ownerId: bia.id, awaitingReplySince: ago(1) });
    await lead({ ownerId: null, awaitingReplySince: ago(1) });
    expect(all(await getQueue(asUser(gestora), { now: NOW, dono: ana.id }))).toEqual([daAna.id]);
    expect(all(await getQueue(asUser(ana), { now: NOW, dono: bia.id })).length).toBe(2);
  });
});

describe("attendanceDue: Na Casa esquecida", () => {
  it("Na Casa de um dia que já passou (Chegou marcado e ninguém finalizou) entra na conferência; a de hoje, não", async () => {
    const { gestora, lead } = await setup();
    const ontem = await lead({ stage: "na_casa", scheduledAt: new Date("2026-10-06T14:00:00Z"), last: { direction: "out" } });
    const hoje = await lead({ stage: "na_casa", scheduledAt: new Date("2026-10-07T12:00:00Z"), last: { direction: "out" } });
    const agendado = await lead({ stage: "agendado", scheduledAt: new Date("2026-10-07T13:00:00Z"), last: { direction: "out" } });
    const due = (await attendanceDue(asUser(gestora), NOW)).map((d) => d.dealId);
    expect(due).toEqual([ontem.id, agendado.id]);
    expect(due).not.toContain(hoje.id);
  });

  it("Psico r68 #8: 'Ela veio?' lê o horário da Agenda: quem já foi finalizado, faltou ou está na Casa não é perguntada", async () => {
    const { gestora, lead } = await setup();
    const fim = await lead({ stage: "agendado", scheduledAt: new Date("2026-10-07T13:00:00Z"), last: { direction: "out" } });
    const falt = await lead({ stage: "agendado", scheduledAt: new Date("2026-10-07T13:00:00Z"), last: { direction: "out" } });
    const dev = await lead({ stage: "agendado", scheduledAt: new Date("2026-10-07T13:00:00Z"), last: { direction: "out" } });
    const put = async (id: string, status: string) => {
      const [d] = await db.select().from(deals).where(eq(deals.id, id));
      await db.insert(appointments).values({ contactId: d.contactId, serviceLabel: "Corte", startsAt: d.scheduledAt!, status, externalKey: `q:${id}` });
    };
    await put(fim.id, "compareceu"); await put(falt.id, "faltou");
    expect((await attendanceDue(asUser(gestora), NOW)).map((d) => d.dealId)).toEqual([dev.id]);
  });

  it("cliente com as automáticas pausadas ganha o selo 'Automáticas pausadas'; pausa vencida não", async () => {
    const { ana, gestora, lead } = await setup();
    const d = await lead({ ownerId: ana.id, awaitingReplySince: ago(1), client: true, last: { direction: "in", body: "Oi" } });
    const sela = async () => (await getQueue(asUser(gestora), { now: NOW })).sections.flatMap((s) => s.items).find((x) => x.dealId === d.id)?.badges ?? [];
    expect(await sela()).not.toContain("Automáticas pausadas");
    await db.update(contacts).set({ automationsPausedUntil: new Date(NOW.getTime() + 3_600_000) }).where(eq(contacts.id, d.contactId));
    expect(await sela()).toContain("Automáticas pausadas");
    await db.update(contacts).set({ automationsPausedUntil: new Date(NOW.getTime() - 3_600_000) }).where(eq(contacts.id, d.contactId));
    expect(await sela()).not.toContain("Automáticas pausadas");
  });
});
