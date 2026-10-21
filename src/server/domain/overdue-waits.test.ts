import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { sweepOverdueWaits } from "./overdue-waits";

// quarta 14/10, 10h em Salvador (Casa aberta)
const NOW = new Date(Date.UTC(2026, 9, 14, 13, 0));
const bahia = (day: number, h: number) => new Date(Date.UTC(2026, 9, day, h + 3));
let ana = "";
beforeEach(async () => {
  await resetDb();
  ana = (await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning())[0].id;
});
async function lead(kind: "lead" | "atendimento" | "agendado" | "followup", since: Date | null, name = "Rita") {
  const [st] = await db.select().from(stages).where(eq(stages.kind, kind));
  const [c] = await db.insert(contacts).values({ name, phoneE164: `+55719999${Math.floor(Math.random() * 1e5).toString().padStart(5, "0")}` }).returning();
  const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, ownerId: ana, awaitingReplySince: since }).returning();
  return d;
}
const stageOf = async (id: string) => (await db.select({ key: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].key;

describe("espera vencida: quem espera é a CLIENTE, então a conversa nunca vai para Aguardando (Lote 1C)", () => {
  it("Em conversa com a cliente sem resposta desde ontem: continua em Em conversa e atrasada (espera e aviso ficam)", async () => {
    const d = await lead("atendimento", bahia(13, 15));
    await db.insert(alerts).values({ dealId: d.id, userId: ana, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `espera:${d.id}` });
    expect(await sweepOverdueWaits(NOW)).toEqual({ moved: 0, cleared: 0 });
    expect(await stageOf(d.id)).toBe("atendimento");
    expect((await db.select().from(deals).where(eq(deals.id, d.id)))[0].awaitingReplySince).not.toBeNull();
    expect(await db.select().from(alerts).where(and(eq(alerts.dealId, d.id), isNull(alerts.resolvedAt)))).toHaveLength(1);
    expect(await db.select().from(tasks).where(eq(tasks.dealId, d.id))).toHaveLength(0);
  });

  it("Novo contato com espera antiga também fica onde está", async () => {
    const d = await lead("lead", new Date(Date.UTC(2026, 8, 1, 12)));
    await sweepOverdueWaits(NOW);
    expect(await stageOf(d.id)).toBe("lead");
  });

  it("Aguardando cliente com a cliente esperando (sobra de antes da regra): volta já para Em conversa, mantendo a espera", async () => {
    const d = await lead("followup", bahia(14, 8));
    expect((await sweepOverdueWaits(NOW)).moved).toBe(1);
    expect(await stageOf(d.id)).toBe("atendimento");
    expect((await db.select().from(deals).where(eq(deals.id, d.id)))[0].awaitingReplySince).not.toBeNull();
  });

  it("agendada não perde o horário: só sai da espera, sem mudar de etapa", async () => {
    const d = await lead("agendado", bahia(13, 15));
    expect((await sweepOverdueWaits(NOW)).cleared).toBe(1);
    expect(await stageOf(d.id)).toBe("agendado");
    expect((await db.select().from(deals).where(eq(deals.id, d.id)))[0].awaitingReplySince).toBeNull();
  });
});

describe("espera aberta só por agradecimento", () => {
  it("\"Obrigada!\" depois da resposta da Casa deixa de esperar (conversas que já estavam assim)", async () => {
    const { recordOutbound } = await import("./deals");
    const { sweepClosingWaits } = await import("./overdue-waits");
    const a = await recordInbound({ channelId: null, externalId: "C1", phoneRaw: "71990000007", body: "Vocês fazem?", at: bahia(14, 8) });
    const b = await recordInbound({ channelId: null, externalId: "D1", phoneRaw: "71992039858", body: "Oi", at: bahia(14, 8) });
    if (!("dealId" in a) || !("dealId" in b)) throw new Error("sem lead");
    await recordOutbound({ dealId: a.dealId, channelId: null, body: "Sim", at: new Date(Date.UTC(2026, 9, 14, 11, 30)) });
    await recordOutbound({ dealId: b.dealId, channelId: null, body: "Olá", at: new Date(Date.UTC(2026, 9, 14, 11, 30)) });
    // como era antes da regra: o agradecimento abriu a espera
    await db.update(deals).set({ awaitingReplySince: bahia(14, 9) }).where(eq(deals.id, a.dealId));
    await recordInbound({ channelId: null, externalId: "C2", phoneRaw: "71990000007", body: "Obrigada!", at: bahia(14, 9) });
    await db.update(deals).set({ awaitingReplySince: bahia(14, 9) }).where(eq(deals.id, a.dealId));
    await recordInbound({ channelId: null, externalId: "D2", phoneRaw: "71992039858", body: "Obrigada! E o valor?", at: bahia(14, 9) });
    const r = await sweepClosingWaits(NOW);
    expect(r.cleared).toBe(1);
    const [da] = await db.select().from(deals).where(eq(deals.id, a.dealId));
    const [db2] = await db.select().from(deals).where(eq(deals.id, b.dealId));
    expect(da.awaitingReplySince).toBeNull();
    expect(db2.awaitingReplySince).not.toBeNull();
  });
});
