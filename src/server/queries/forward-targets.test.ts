import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, users } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { forwardTargets } from "./forward-targets";

let chId = "", uid = "";
const mk = async (phone: string, name: string, kind: "cliente" | "equipe" | "fornecedor" | "spam" = "cliente", ownerId: string | null = null) => {
  const r = await recordInbound({ channelId: chId, externalId: `I${phone}`, phoneRaw: phone, body: "oi" });
  if (!("dealId" in r)) throw new Error("x");
  const [d] = await db.select().from(deals).where(eq(deals.id, r.dealId));
  await db.update(contacts).set({ name, kind }).where(eq(contacts.id, d.contactId));
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return r.dealId;
};
beforeEach(async () => {
  await resetDb();
  [{ id: uid }] = await db.insert(users).values({ name: "Cati", email: "c@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
});

describe("para quem encaminhar", () => {
  it("Equipe no topo; fornecedor e spam fora; a conversa de origem fora", async () => {
    const a = await mk("71911110001", "Ana Cliente"), e = await mk("71911110002", "Sara Equipe", "equipe");
    await mk("71911110003", "Forn", "fornecedor"); await mk("71911110004", "Spam", "spam");
    const r = await forwardTargets({ id: uid, perms: ["atendimento.todas"] }, "", a);
    expect(r.map((x) => x.dealId)).toEqual([e]);
    expect(r[0]).toMatchObject({ team: true, name: "Sara Equipe" });
    expect((await forwardTargets({ id: uid, perms: ["atendimento.todas"] }, "")).map((x) => x.team)).toEqual([true, false]);
  });
  it("busca por nome e por telefone", async () => {
    await mk("71911110001", "Ana Cliente"); await mk("71911110002", "Bia");
    expect((await forwardTargets({ id: uid, perms: ["atendimento.todas"] }, "ana")).map((x) => x.name)).toEqual(["Ana Cliente"]);
    expect((await forwardTargets({ id: uid, perms: ["atendimento.todas"] }, "91111-0002")).map((x) => x.name)).toEqual(["Bia"]);
  });
  it("sem 'ver todas', não lista a conversa de outra pessoa", async () => {
    const [{ id: other }] = await db.insert(users).values({ name: "Sara", email: "s@c.com", role: "atendente", passwordHash: "x" }).returning();
    await mk("71911110001", "Da outra", "cliente", other); const mine = await mk("71911110002", "Minha", "cliente", uid); const free = await mk("71911110003", "Sem dona");
    const r = await forwardTargets({ id: uid, perms: ["atendimento.ver"] }, "");
    expect(r.map((x) => x.dealId).sort()).toEqual([mine, free].sort());
  });
  it("buscando, aparece também quem não tem conversa aberta (resolvida ou antiga), sem número oculto (20/10)", async () => {
    const d = await mk("71911110005", "Carla Antiga");
    await db.update(deals).set({ archivedAt: new Date() }).where(eq(deals.id, d));
    await db.insert(contacts).values({ name: "Carla Oculta", phoneE164: "lid:999" });
    const r = await forwardTargets({ id: uid, perms: ["atendimento.ver"] }, "carla");
    expect(r.map((x) => [x.name, x.dealId])).toEqual([["Carla Antiga", null]]);
    expect((await forwardTargets({ id: uid, perms: ["atendimento.ver"] }, "")).map((x) => x.name)).not.toContain("Carla Antiga"); // sem busca, só conversas abertas
  });
});
