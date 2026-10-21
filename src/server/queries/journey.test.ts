import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, settings, stages, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { etapasAntigasAtivas } from "../../../test/legacy-stages"; // histórico de antes da nova organização (16/10)
import { getBoard, type BoardStage } from "./board";
import { getJourney, getJourneyStation, JOURNEY_PEOPLE_MAX } from "./journey";
import { BOARD_CLOSED_DAYS } from "../../lib/board-order";

/** Expediente 24 h todos os dias (o mesmo do banco de e2e): o teste não depende da hora em que roda. */
const ALL_DAY = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, ["00:00", "24:00"]]));

let n = 0;
const mk = async (stage: string, over: { owner?: string | null; ignored?: boolean; archived?: boolean; awaiting?: Date | null; avatar?: boolean; name?: string } = {}) => {
  n++;
  const r = await recordInbound({ channelId: null, externalId: `J${n}`, phoneRaw: `71998200${String(n).padStart(3, "0")}`, pushName: over.name ?? `Cliente ${n}`, body: "oi" });
  if (!("dealId" in r)) throw new Error();
  const [st] = await db.select().from(stages).where(eq(stages.key, stage));
  const closed = st.kind === "fechado" || st.kind === "perdido";
  const [d] = await db.update(deals).set({
    ownerId: over.owner ?? null, stageId: st.id, closedAt: closed ? new Date() : null,
    awaitingReplySince: over.awaiting === undefined ? new Date(Date.now() - 60_000) : over.awaiting, archivedAt: over.archived ? new Date() : null,
  }).where(eq(deals.id, r.dealId)).returning();
  if (over.ignored || over.avatar) await db.update(contacts).set({ ignored: !!over.ignored, avatarPath: over.avatar ? "a.jpg" : null }).where(eq(contacts.id, d.contactId));
  return d;
};
/** O Quadro junta Follow-up 1 a 4 numa coluna só; a Jornada faz o mesmo. */
const boardCounts = (b: BoardStage[]) => {
  const out: Record<string, number> = {};
  for (const s of b) { const k = s.kind === "followup" ? "followup" : s.key; out[k] = (out[k] ?? 0) + s.cards.length; }
  return out;
};

beforeEach(async () => { n = 0; await resetDb(); await etapasAntigasAtivas(); });

describe("getJourney", () => {
  it("cada pessoa traz a dona: nome da equipe e iniciais", async () => {
    const [u] = await db.insert(users).values({ name: "Catarina Moura", email: "c@c.com", role: "gestor", passwordHash: "x", signature: "CATI" }).returning();
    const a = await mk("atendimento", { owner: u.id }); const b = await mk("atendimento");
    const people = (await getJourney()).stations.find((s) => s.key === "atendimento")!.people;
    expect(people.find((p) => p.dealId === a.id)).toMatchObject({ ownerName: "Cati", ownerInitials: "CM" });
    expect(people.find((p) => p.dealId === b.id)).toMatchObject({ ownerName: null, ownerInitials: null });
  });

  it("as contagens batem com as colunas do Quadro (Follow-up junto), sem arquivados nem ignorados", async () => {
    await mk("lead"); await mk("lead"); await mk("atendimento"); await mk("followup_1"); await mk("followup_1");
    await mk("agendado"); await mk("fechado"); await mk("perdido");
    await mk("lead", { archived: true }); await mk("atendimento", { ignored: true });
    const j = await getJourney();
    const board = boardCounts(await getBoard({}));
    expect(Object.fromEntries(j.stations.map((s) => [s.key, s.count]))).toEqual(board);
    expect(j.stations.find((s) => s.key === "lead")!.count).toBe(2);
    expect(j.stations.find((s) => s.key === "followup")!.count).toBe(2);
  });

  it("as estações seguem a ordem das etapas e a de Aguardando cliente é uma só", async () => {
    const j = await getJourney();
    expect(j.stations.map((s) => s.key)).toEqual(["lead", "atendimento", "followup", "orcamento", "agendado", "na_casa", "atendida", "retorno", "fechado", "perdido"]);
    expect(j.stations.map((s) => s.kind)).toEqual(["lead", "atendimento", "followup", "proposta", "agendado", "na_casa", "atendido", "retorno", "fechado", "perdido"]);
    expect(j.stations.find((s) => s.key === "followup")!.name).toBe("Aguardando cliente");
  });

  it("conversa encerrada não conta na Jornada (mesma regra do Quadro)", async () => {
    const d = await mk("atendimento");
    await mk("atendimento");
    await db.update(deals).set({ conversationArchivedAt: new Date() }).where(eq(deals.id, d.id));
    expect((await getJourney()).stations.find((s) => s.key === "atendimento")!.count).toBe(1);
  });

  it("atrasados: leads com alerta de espera aberto, um por lead, a mesma regra do sino", async () => {
    const a = await mk("lead"), b = await mk("lead"), c = await mk("followup_1");
    await mk("lead");
    for (const [i, d] of [a, b, b, c].entries()) await db.insert(alerts).values({ dealId: d.id, type: "sem_resposta_minutos", message: "x", dedupeKey: `k${i}`, waitKey: `${d.id}:espera${i}`, level: i === 2 ? 2 : 1 });
    const j = await getJourney();
    expect(j.stations.find((s) => s.key === "lead")).toMatchObject({ count: 3, late: 2 });
    expect(j.stations.find((s) => s.key === "followup")).toMatchObject({ count: 1, late: 1 });
    expect(j.stations.find((s) => s.key === "atendimento")).toMatchObject({ count: 0, late: 0, people: [], more: 0 });
  });

  it("pessoas: até 12 por estação e '+N' para o resto, os mais urgentes primeiro", async () => {
    // A espera conta só o expediente: com a Casa fechada (noite, domingo) todas valem 0 e a ordem viraria empate. Casa aberta 24 h no teste.
    await db.insert(settings).values({ key: "business_hours", value: ALL_DAY });
    const all = [];
    for (let i = 0; i < JOURNEY_PEOPLE_MAX + 3; i++) all.push(await mk("lead", { awaiting: new Date(Date.now() - (i + 1) * 60_000), avatar: i === 0, name: `Pessoa ${i}` }));
    const lead = (await getJourney()).stations.find((s) => s.key === "lead")!;
    expect(lead.count).toBe(JOURNEY_PEOPLE_MAX + 3);
    expect(lead.people).toHaveLength(JOURNEY_PEOPLE_MAX);
    expect(lead.more).toBe(3);
    // quem espera há mais tempo primeiro (a última criada)
    expect(lead.people[0]).toMatchObject({ dealId: all.at(-1)!.id, name: "Pessoa 14", hasAvatar: false });
    expect(lead.people[0].awaitingSince).toEqual(expect.any(String));
    expect(lead.people.at(-1)!.dealId).toBe(all[3].id);
    // o formato do brief
    expect(Object.keys(lead.people[0]).sort()).toEqual(expect.arrayContaining(["awaitingSince", "contactId", "dealId", "hasAvatar", "name"]));
  });

  it("o '+N' abre a estação inteira: todas as pessoas, na mesma ordem, só daquela estação", async () => {
    await db.insert(settings).values({ key: "business_hours", value: ALL_DAY });
    const all = [];
    for (let i = 0; i < JOURNEY_PEOPLE_MAX + 3; i++) all.push(await mk("lead", { awaiting: new Date(Date.now() - (i + 1) * 60_000), name: `Pessoa ${i}` }));
    await mk("atendimento", { name: "Outra estação" });
    const people = await getJourneyStation("lead");
    expect(people).toHaveLength(JOURNEY_PEOPLE_MAX + 3);
    expect(people[0].dealId).toBe(all.at(-1)!.id);
    expect(people.at(-1)!.dealId).toBe(all[0].id);
    expect(people.map((p) => p.name)).not.toContain("Outra estação");
    const first = (await getJourney()).stations.find((s) => s.key === "lead")!.people;
    expect(people.slice(0, JOURNEY_PEOPLE_MAX).map((p) => p.dealId)).toEqual(first.map((p) => p.dealId));
  });

  it("quem não tem nome aparece pelo telefone, e a espera é null quando a bola está com a cliente", async () => {
    const d = await mk("atendimento", { awaiting: null });
    await db.update(contacts).set({ name: null }).where(eq(contacts.id, d.contactId));
    const p = (await getJourney()).stations.find((s) => s.key === "atendimento")!.people[0];
    expect(p.name).toMatch(/\d/);
    expect(p.awaitingSince).toBeNull();
  });

  it("não depende de quem olha: a gestão vê todos os donos", async () => {
    const [ana] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
    await mk("lead", { owner: ana.id }); await mk("lead");
    expect((await getJourney()).stations.find((s) => s.key === "lead")!.count).toBe(2);
  });

  it("cada pessoa traz o que o rótulo da estação precisa: horário marcado, quando fechou e o valor", async () => {
    const ag = await mk("agendado", { awaiting: null });
    await db.update(deals).set({ scheduledAt: new Date("2026-10-13T18:00:00Z") }).where(eq(deals.id, ag.id));
    const fe = await mk("fechado", { awaiting: null });
    const quando = new Date(Date.now() - 3 * 86_400_000);
    await db.update(deals).set({ closedAt: quando, valueCents: 25000 }).where(eq(deals.id, fe.id));
    const j = await getJourney();
    expect(j.stations.find((s) => s.key === "agendado")!.people[0]).toMatchObject({ scheduledAt: "2026-10-13T18:00:00.000Z", closedAt: null, valueCents: null });
    expect(j.stations.find((s) => s.key === "fechado")!.people[0]).toMatchObject({ closedAt: quando.toISOString(), valueCents: 25000, scheduledAt: null });
  });

  it("fechados e perdidos entram só dentro do período do Quadro (BOARD_CLOSED_DAYS)", async () => {
    expect(BOARD_CLOSED_DAYS).toBe(30);
    const dentro = await mk("fechado", { awaiting: null }), fora = await mk("perdido", { awaiting: null });
    await db.update(deals).set({ closedAt: new Date(Date.now() - (BOARD_CLOSED_DAYS - 1) * 86_400_000) }).where(eq(deals.id, dentro.id));
    await db.update(deals).set({ closedAt: new Date(Date.now() - (BOARD_CLOSED_DAYS + 1) * 86_400_000) }).where(eq(deals.id, fora.id));
    const j = await getJourney();
    expect(j.stations.find((s) => s.key === "fechado")!.count).toBe(1);
    expect(j.stations.find((s) => s.key === "perdido")!.count).toBe(0);
    expect(boardCounts(await getBoard({}))).toMatchObject({ fechado: 1, perdido: 0 });
  });
});

describe("getJourney: contagem própria em SQL (não passa pelo limite de leads do Quadro)", () => {
  /** A mesma pergunta do Quadro, direto no banco: leads abertos, ou fechados no período; sem arquivados nem ignorados; etapa ativa. */
  const sqlCounts = async () => {
    const { rows } = await db.execute<{ key: string; n: number; late: number }>(sql`
      select case when s.kind = 'followup' then 'followup' else s.key end as key, count(*)::int as n,
        count(*) filter (where exists (select 1 from alerts al where al.deal_id = d.id and al.wait_key is not null and al.wait_key not like 'task:%' and al.resolved_at is null))::int as late
      from deals d join contacts c on c.id = d.contact_id join stages s on s.id = d.stage_id
      where s.active and d.archived_at is null and not c.ignored and (d.closed_at is null or d.closed_at >= now() - make_interval(days => ${BOARD_CLOSED_DAYS}))
      group by 1`);
    return Object.fromEntries(rows.map((r) => [r.key, { n: r.n, late: r.late }]));
  };

  it("com mais de 600 leads, a Jornada conta todos e os atrasados certos; só as pessoas são 12 por estação", async () => {
    await db.execute(sql`insert into contacts (name, phone_e164) select 'Massa ' || g, '+55719990' || lpad(g::text, 5, '0') from generate_series(1, 650) g`);
    await db.execute(sql`insert into deals (contact_id, stage_id, awaiting_reply_since, stage_entered_at)
      select c.id, (select id from stages where key = case when c.name like '%0' then 'atendimento' else 'lead' end), now() - interval '1 minute', now() - interval '1 hour'
      from contacts c where c.name like 'Massa %'`);
    // 40 atrasados, espalhados (inclusive entre os que o Quadro cortaria)
    await db.execute(sql`insert into alerts (deal_id, type, message, dedupe_key, wait_key)
      select d.id, 'sem_resposta_minutos', 'x', 'massa-' || d.id, d.id || ':espera' from deals d order by d.id limit 40`);
    const j = await getJourney();
    const esperado = await sqlCounts();
    for (const s of j.stations) expect({ n: s.count, late: s.late }, s.key).toEqual(esperado[s.key] ?? { n: 0, late: 0 });
    expect(j.stations.find((s) => s.key === "lead")!.count).toBe(585);
    expect(j.stations.find((s) => s.key === "atendimento")!.count).toBe(65);
    expect(j.stations.reduce((n, s) => n + s.late, 0)).toBe(40);
    for (const s of j.stations) { expect(s.people.length).toBe(Math.min(s.count, JOURNEY_PEOPLE_MAX)); expect(s.more).toBe(s.count - s.people.length); }
    // o Quadro, esse sim, corta em 600
    expect((await getBoard({})).reduce((n, s) => n + s.cards.length, 0)).toBe(600);
  });

  it("os atrasados vêm primeiro entre as 12 pessoas, mesmo quando esperam menos tempo que os outros", async () => {
    const velhos = [];
    for (let i = 0; i < 14; i++) velhos.push(await mk("lead", { awaiting: new Date(Date.now() - (60 + i) * 60_000), name: `Velho ${i}` }));
    const atrasado = await mk("lead", { awaiting: new Date(Date.now() - 30_000), name: "Atrasado recente" });
    await db.insert(alerts).values({ dealId: atrasado.id, type: "sem_resposta_minutos", message: "x", dedupeKey: "kk", waitKey: `${atrasado.id}:espera` });
    const lead = (await getJourney()).stations.find((s) => s.key === "lead")!;
    expect(lead.people[0]).toMatchObject({ dealId: atrasado.id, urgency: "late" });
    expect(lead.people).toHaveLength(JOURNEY_PEOPLE_MAX);
  });
});
