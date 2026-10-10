import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, stages, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { getBoard, type BoardStage } from "./board";
import { getJourney, JOURNEY_PEOPLE_MAX } from "./journey";

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

beforeEach(async () => { n = 0; await resetDb(); });

describe("getJourney", () => {
  it("as contagens batem com as colunas do Quadro (Follow-up junto), sem arquivados nem ignorados", async () => {
    await mk("lead"); await mk("lead"); await mk("atendimento"); await mk("followup_1"); await mk("followup_3");
    await mk("agendado"); await mk("fechado"); await mk("perdido");
    await mk("lead", { archived: true }); await mk("atendimento", { ignored: true });
    const j = await getJourney();
    const board = boardCounts(await getBoard({}));
    expect(Object.fromEntries(j.stations.map((s) => [s.key, s.count]))).toEqual(board);
    expect(j.stations.find((s) => s.key === "lead")!.count).toBe(2);
    expect(j.stations.find((s) => s.key === "followup")!.count).toBe(2);
  });

  it("as estações seguem a ordem das etapas e a de Follow-up é uma só", async () => {
    const j = await getJourney();
    expect(j.stations.map((s) => s.key)).toEqual(["lead", "atendimento", "agendado", "followup", "fechado", "perdido"]);
    expect(j.stations.map((s) => s.kind)).toEqual(["lead", "atendimento", "agendado", "followup", "fechado", "perdido"]);
    expect(j.stations.find((s) => s.key === "followup")!.name).toBe("Follow-up");
  });

  it("atrasados: leads com alerta de espera aberto, um por lead, a mesma regra do sino", async () => {
    const a = await mk("lead"), b = await mk("lead"), c = await mk("followup_2");
    await mk("lead");
    for (const [i, d] of [a, b, b, c].entries()) await db.insert(alerts).values({ dealId: d.id, type: "sem_resposta_minutos", message: "x", dedupeKey: `k${i}`, waitKey: `${d.id}:espera${i}`, level: i === 2 ? 2 : 1 });
    const j = await getJourney();
    expect(j.stations.find((s) => s.key === "lead")).toMatchObject({ count: 3, late: 2 });
    expect(j.stations.find((s) => s.key === "followup")).toMatchObject({ count: 1, late: 1 });
    expect(j.stations.find((s) => s.key === "atendimento")).toMatchObject({ count: 0, late: 0, people: [], more: 0 });
  });

  it("pessoas: até 12 por estação e '+N' para o resto, os mais urgentes primeiro", async () => {
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
});
