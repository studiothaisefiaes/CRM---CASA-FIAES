import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { permsFor } from "../../../test/perms";
import { db } from "../db";
import { alerts, contacts, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { ignoreContact } from "./deals";
import { markSeen } from "./seen";
import { setTeamContact } from "./team-contact";
import { getQueue } from "../queries/queue";
import { getJourney } from "../queries/journey";
import { countLateLeads } from "../queries/late-count";
import { candidatesFor } from "../rules/engine";
import { dealScope } from "../reports/common";
import { sql } from "drizzle-orm";

const ALL_DAY: [string, string] = ["00:00", "24:00"];
let gestora = { id: "", name: "Gestora", email: "g@c.com", perms: permsFor("gestor") };
const inbound = async (phone: string, ext: string, body: string, at = new Date()) => recordInbound({ channelId: null, externalId: ext, phoneRaw: phone, pushName: "Pessoa Teste", body, at });
const dealIdOf = async (phone: string) => (await db.select({ id: deals.id }).from(deals).innerJoin(contacts, eq(contacts.id, deals.contactId)).where(eq(contacts.phoneE164, phone)))[0].id;
const ids = (q: Awaited<ReturnType<typeof getQueue>>) => q.sections.flatMap((s) => s.items.map((i) => i.dealId));

beforeEach(async () => {
  await resetDb();
  const [g] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  gestora = { ...gestora, id: g.id };
});

describe("Equipe: número de funcionária avisa, mas fica fora do funil e das métricas", () => {
  it("vai para a aba Equipe com não lida e aviso no sino; fora de Todas, das contagens, do Quadro/Jornada, dos prazos e dos relatórios", async () => {
    await inbound("71900000201", "E1", "oi, cliente");
    await inbound("71900000202", "E2", "chego 9h amanhã");
    const team = await dealIdOf("+5571900000202");
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571900000202"));
    await setTeamContact(c.id, true, gestora.id);
    await inbound("71900000202", "E3", "a chave tá com quem?");

    const q = await getQueue(gestora);
    expect(ids(q)).not.toContain(team);
    expect(q.counts.total).toBe(1);
    expect(q.counts.naoLidas).toBe(1);
    expect(q.counts.views.equipe).toBe(1);
    expect(q.counts.equipeNaoLidas).toBe(1);
    const eq1 = await getQueue(gestora, { view: "equipe" });
    expect(ids(eq1)).toEqual([team]);
    expect(eq1.sections[0].items[0].unread).toBe(2);
    // avisa no sino como qualquer conversa
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, team), eq(alerts.type, "mensagem_cliente"), isNull(alerts.resolvedAt)))).toHaveLength(1);
    // fora do funil, dos prazos e das métricas
    const lead = (await getJourney()).stations.find((s) => s.key === "lead")!;
    expect(lead.count).toBe(1);
    await db.insert(alerts).values({ dealId: team, audience: "gestao", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "x1", waitKey: `${team}:x` });
    expect(await countLateLeads(gestora)).toBe(0);
    const late = await candidatesFor({ type: "sem_resposta_minutos", minutes: 0, useStageSla: false } as never, new Date(Date.now() + 3_600_000), { 0: ALL_DAY, 1: ALL_DAY, 2: ALL_DAY, 3: ALL_DAY, 4: ALL_DAY, 5: ALL_DAY, 6: ALL_DAY });
    expect(late.map((x) => x.dealId)).not.toContain(team);
    const inReports = await db.execute(sql`select d.id from deals d where ${dealScope({ period: "hoje" })}`);
    expect((inReports.rows as { id: string }[]).map((r) => r.id)).not.toContain(team);
  });

  it("'Não é cliente' marcado como Equipe volta (o lead arquivado é restaurado); desmarcar devolve à Fila de clientes", async () => {
    await inbound("71900000203", "F1", "oi");
    const id = await dealIdOf("+5571900000203");
    await ignoreContact(id, gestora.id);
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571900000203"));
    await setTeamContact(c.id, true, gestora.id);
    const [after] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(after).toMatchObject({ ignored: false, isTeam: true });
    expect(ids(await getQueue(gestora, { view: "equipe" }))).toEqual([id]);
    await setTeamContact(c.id, false, gestora.id);
    expect(ids(await getQueue(gestora))).toEqual([id]);
    expect(ids(await getQueue(gestora, { view: "equipe" }))).toEqual([]);
  });
});

describe("'Não é cliente' que manda mensagem nova não some sem rastro", () => {
  it("fica em Filtros › Não é cliente como não lida; abrir a conversa marca como vista", async () => {
    await inbound("71900000204", "G1", "oi");
    const id = await dealIdOf("+5571900000204");
    await ignoreContact(id, gestora.id);
    expect((await getQueue(gestora)).counts.views["nao-cliente"]).toBe(0);
    expect(await inbound("71900000204", "G2", "vocês têm vaga sábado?", new Date(Date.now() + 1000))).toEqual({ ignored: true });
    let q = await getQueue(gestora);
    expect(ids(q)).not.toContain(id);
    expect(q.counts.views["nao-cliente"]).toBe(1);
    q = await getQueue(gestora, { view: "nao-cliente" });
    expect(ids(q)).toEqual([id]);
    expect(q.sections[0].items[0].unread).toBe(1);
    await markSeen(id, gestora.id, new Date(Date.now() + 2000));
    expect((await getQueue(gestora)).counts.views["nao-cliente"]).toBe(0);
    expect(ids(await getQueue(gestora, { view: "nao-cliente" }))).toEqual([id]);
  });
});
