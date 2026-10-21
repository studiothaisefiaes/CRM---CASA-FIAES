import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, deals, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { resetDb } from "../../../test/db";
import { permsFor } from "../../../test/perms";
import { saveFuncao } from "./funcoes";
import { markSeen } from "./seen";
import { followingOf, markUnread, setFollowing } from "./follow";
import { getQueue } from "../queries/queue";

let cati = "", sara = "", gestor = "", dealId = "", chId = "";
const asUser = (id: string, name: string) => ({ id, name, email: `${id}@c.com`, perms: permsFor("gestor") });
const unreadOf = async () => { const q = await getQueue(asUser(gestor, "T"), { aba: "nao-lidas" }); return q.sections.flatMap((x) => x.items).filter((i) => i.dealId === dealId); };

beforeEach(async () => {
  await resetDb();
  [{ id: cati }] = await db.insert(users).values({ name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaise", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  const r = await recordInbound({ channelId: chId, externalId: "IN1", phoneRaw: "71999995555", body: "oi", pushName: "Maria Souza" });
  if (!("dealId" in r)) throw new Error("x");
  dealId = r.dealId;
  await markSeen(dealId, cati);
  // A Casa respondeu: a última mensagem é da Casa e não há nada não lido.
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  await db.insert(messages).values({ dealId, contactId: d.contactId, direction: "out", kind: "text", body: "Olá!", status: "sent" });
  await db.update(deals).set({ lastOutboundAt: new Date(Date.now() + 1000), awaitingReplySince: null }).where(eq(deals.id, dealId));
});

describe("marcar como não lida", () => {
  it("põe a conversa em Não lidas, mesmo com a última mensagem sendo da Casa", async () => {
    expect(await unreadOf()).toEqual([]);
    await markUnread(dealId, cati);
    const it1 = await unreadOf();
    expect(it1).toHaveLength(1);
    expect(it1[0].unread).toBeGreaterThan(0);
  });
  it("não cria aviso no sino", async () => {
    const before = (await db.select().from(alerts)).length;
    await markUnread(dealId, cati);
    expect((await db.select().from(alerts)).length).toBe(before);
  });
  it("abrir a conversa limpa a marca", async () => {
    await markUnread(dealId, cati);
    await markSeen(dealId, sara);
    expect(await unreadOf()).toEqual([]);
    const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
    expect(d.markedUnreadAt).toBeNull();
  });
  it("função desligada recusa", async () => {
    await saveFuncao("marcar_nao_lida", { on: false }, gestor, { confirmouEnvio: false });
    await expect(markUnread(dealId, cati)).rejects.toThrow("Marcar como não lida está desligada em Configurações › Recursos.");
  });
});

describe("acompanhar", () => {
  it("é por pessoa: Sara acompanha, Cati não vê na lista dela", async () => {
    await setFollowing(dealId, sara, true);
    expect((await followingOf(sara)).map((f) => f.dealId)).toEqual([dealId]);
    expect(await followingOf(cati)).toEqual([]);
  });
  it("acompanhar duas vezes não duplica; desmarcar tira", async () => {
    await setFollowing(dealId, sara, true); await setFollowing(dealId, sara, true);
    expect(await followingOf(sara)).toHaveLength(1);
    await setFollowing(dealId, sara, false);
    expect(await followingOf(sara)).toEqual([]);
  });
  it("conversa resolvida continua em Acompanhando até a pessoa desmarcar", async () => {
    await setFollowing(dealId, sara, true);
    await db.update(deals).set({ resolvedAt: new Date(), conversationArchivedAt: new Date() }).where(eq(deals.id, dealId));
    expect(await followingOf(sara)).toHaveLength(1);
  });
  it("mostra o nome, a última mensagem e se a cliente espera a Casa", async () => {
    await setFollowing(dealId, sara, true);
    const [f] = await followingOf(sara);
    expect(f.name).toBe("Maria Souza");
    expect(f.lastAt).not.toBeNull();
    expect(f.waiting).toBe(false);
    await db.update(deals).set({ awaitingReplySince: new Date() }).where(eq(deals.id, dealId));
    expect((await followingOf(sara))[0].waiting).toBe(true);
  });
  it("função desligada recusa e a lista some", async () => {
    await setFollowing(dealId, sara, true);
    await saveFuncao("acompanhar", { on: false }, gestor, { confirmouEnvio: false });
    await expect(setFollowing(dealId, sara, true)).rejects.toThrow("Acompanhar está desligada em Configurações › Recursos.");
    expect(await followingOf(sara)).toEqual([]);
  });
});
