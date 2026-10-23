import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { recordInbound, recordOutbound } from "./deals";
import { archiveConversation, unarchiveConversation } from "./conversation-archive";
import { getQueue } from "../queries/queue";

const MIN = 60_000;
let gest: { id: string; perms: ReturnType<typeof permsFor> };
const inbound = async (phone: string, body: string, at = new Date()) => {
  const r = await recordInbound({ channelId: null, externalId: `${phone}-${at.getTime()}-${body}`, phoneRaw: phone, pushName: "Rita", body, at });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};
const names = async (view?: "arquivadas") => (await getQueue(gest, { view })).sections.flatMap((s) => s.items.map((i) => i.dealId));
/** As seções abertas da Fila. Desde 20/10 a aba Todas também lista as resolvidas, numa seção própria ("arquivadas"). */
const openNames = async () => (await getQueue(gest, {})).sections.filter((s) => s.key !== "arquivadas").flatMap((s) => s.items.map((i) => i.dealId));

beforeEach(async () => {
  await resetDb();
  const [g] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
  gest = { id: g.id, perms: permsFor("gestor") };
});

describe("arquivar conversa", () => {
  it("sai da Fila (e da espera) e aparece em Arquivadas; nada de 'não é cliente'", async () => {
    const id = await inbound("71998700001", "obrigada!", new Date(Date.now() - 5 * MIN));
    await db.insert(alerts).values({ dealId: id, audience: "responsavel", type: "sem_resposta_minutos", severity: "urgente", message: "m", dedupeKey: "k1", waitKey: `espera:${id}` });
    await archiveConversation(id, gest.id);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.conversationArchivedAt).not.toBeNull();
    expect(d.awaitingReplySince).toBeNull();
    expect(d.archivedAt).toBeNull();
    expect((await db.select().from(alerts).where(eq(alerts.dealId, id)))[0].resolvedAt).not.toBeNull();
    expect(await openNames()).not.toContain(id);
    expect(await names("arquivadas")).toEqual([id]);
    const q = await getQueue(gest, {});
    expect(q.counts.views.arquivadas).toBe(1);
  });

  it("a cliente escreveu de novo: volta para a Fila esperando resposta", async () => {
    const id = await inbound("71998700002", "obrigada!", new Date(Date.now() - 10 * MIN));
    await archiveConversation(id, gest.id);
    const again = await inbound("71998700002", "oi, quero remarcar");
    expect(again).toBe(id);
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.conversationArchivedAt).toBeNull();
    expect(d.awaitingReplySince).not.toBeNull();
    expect(await openNames()).toContain(id);
    expect(await names("arquivadas")).toEqual([]);
  });

  it("a Casa mandou mensagem: também volta", async () => {
    const id = await inbound("71998700003", "valeu", new Date(Date.now() - 10 * MIN));
    await archiveConversation(id, gest.id);
    await recordOutbound({ dealId: id, channelId: null, body: "Oi Rita, tudo bem?", userId: gest.id });
    const [d] = await db.select().from(deals).where(eq(deals.id, id));
    expect(d.conversationArchivedAt).toBeNull();
  });

  it("desarquivar na mão devolve para a Fila", async () => {
    const id = await inbound("71998700004", "ok", new Date(Date.now() - 10 * MIN));
    await archiveConversation(id, gest.id);
    await unarchiveConversation(id, gest.id);
    expect(await openNames()).toContain(id);
  });
});
