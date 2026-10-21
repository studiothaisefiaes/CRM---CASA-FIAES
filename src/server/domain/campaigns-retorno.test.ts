import { beforeEach, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, dealEvents, deals, messages, settings, stages, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { confirmCampaign, createCampaign, drainCampaigns, previewAudience, saveMassSettings } from "./campaigns";
import { expireReturnInvites } from "./return-invite";
import { getQueue } from "../queries/queue";
import { permsFor } from "../../../test/perms";

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date("2026-10-20T13:00:00Z"); // terça 10:00
const sent: string[] = [];
const sender = async (i: { instance: string; phone: string; text: string }) => { sent.push(i.phone); return { externalId: `MASS${sent.length}` }; };
let gestao = "";
const actor = () => ({ id: gestao, perms: ["mensagem.massa"] });
const kindOf = async (dealId: string) => (await db.select({ k: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].k;

beforeEach(async () => {
  sent.length = 0;
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: gestao }] = await db.insert(users).values({ name: "Gestora Teste", email: "g@teste.local", role: "gestor", passwordHash: "x" }).returning();
  await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" });
  await saveMassSettings({ enabled: true }, gestao);
});

/** Conversa que a cliente começou e a Casa encerrou (atendimento terminado). */
async function encerrada(phone: string) {
  const r = await recordInbound({ channelId: null, externalId: `IN${phone}`, phoneRaw: phone, pushName: "Rita Teste", body: "oi", at: new Date("2026-09-01T13:00:00Z") });
  if (!("dealId" in r)) throw new Error();
  await db.update(deals).set({ conversationArchivedAt: new Date("2026-09-02T13:00:00Z"), awaitingReplySince: null }).where(eq(deals.id, r.dealId));
  const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, `+55${phone}`));
  return { dealId: r.dealId, contactId: c.id };
}
async function manda(contactIds: string[]) {
  const { id } = await createCampaign({ name: "Retorno", body: "Oi, {primeiro_nome}! Sentimos sua falta.", audience: { contactIds }, intervalSeconds: 120 }, actor(), T0);
  await confirmCampaign(id, { typedTotal: contactIds.length, acceptRisk: true }, actor(), T0);
  for (let i = 0; i < contactIds.length; i++) await drainCampaigns(new Date(T0.getTime() + i * 3 * 60_000), sender);
}

it("conversa encerrada recebe o convite; conversa aberta não", async () => {
  const fechada = await encerrada("71999990081");
  const r = await recordInbound({ channelId: null, externalId: "IN-aberta", phoneRaw: "71999990082", pushName: "Aberta Teste", body: "oi", at: T0 });
  if (!("dealId" in r)) throw new Error();
  const [aberta] = await db.select().from(contacts).where(eq(contacts.phoneE164, "+5571999990082"));
  const p = await previewAudience({ contactIds: [fechada.contactId, aberta.id] }, T0);
  expect(p.eligible).toBe(1);
  expect(p.excluded).toEqual([expect.objectContaining({ reason: "conversa_aberta", n: 1 })]);
});

it("o convite ABRE a conversa encerrada em Em conversa, com o selo 'Convite de retorno' e sem tentativas", async () => {
  const { dealId, contactId } = await encerrada("71999990081");
  await manda([contactId]);
  expect(sent).toHaveLength(1);
  const [d] = await db.select().from(deals).where(eq(deals.id, dealId));
  expect(d.conversationArchivedAt).toBeNull();
  expect(await kindOf(dealId)).toBe("atendimento");
  expect(d.followupAttempt).toBe(0);
  expect(await db.select().from(tasks).where(and(eq(tasks.dealId, dealId), isNull(tasks.doneAt)))).toHaveLength(0);
  const [out] = (await db.select().from(messages).where(eq(messages.contactId, contactId))).filter((m) => m.direction === "out");
  expect(out.dealId).toBe(dealId);
  expect(await db.select().from(dealEvents).where(and(eq(dealEvents.dealId, dealId), eq(dealEvents.type, "convite_retorno")))).toHaveLength(1);
  const q = await getQueue({ id: gestao, perms: permsFor("gestor") }, { now: new Date(T0.getTime() + 60 * 60_000) });
  expect(q.sections.flatMap((s) => s.items).find((i) => i.dealId === dealId)?.badges).toContain("Convite de retorno");
});

it("ela responde: segue em Em conversa e o selo sai", async () => {
  const { dealId, contactId } = await encerrada("71999990081");
  await manda([contactId]);
  await recordInbound({ channelId: null, externalId: "IN-volta", phoneRaw: "71999990081", body: "Quero marcar!", at: new Date(T0.getTime() + 2 * 3_600_000) });
  expect(await kindOf(dealId)).toBe("atendimento");
  const q = await getQueue({ id: gestao, perms: permsFor("gestor") }, { now: new Date(T0.getTime() + 3 * 3_600_000) });
  expect(q.sections.flatMap((s) => s.items).find((i) => i.dealId === dealId)?.badges ?? []).not.toContain("Convite de retorno");
});

it("14 dias sem resposta: volta a encerrada", async () => {
  const { dealId, contactId } = await encerrada("71999990081");
  await manda([contactId]);
  expect(await expireReturnInvites(new Date(T0.getTime() + 13 * 86_400_000))).toBe(0);
  expect(await expireReturnInvites(new Date(T0.getTime() + 14 * 86_400_000 + 60_000))).toBe(1);
  expect((await db.select().from(deals).where(eq(deals.id, dealId)))[0].conversationArchivedAt).not.toBeNull();
});

it("quem só tinha conversado (sem conversa no CRM) também abre em Em conversa", async () => {
  const [c] = await db.insert(contacts).values({ name: "Antiga Teste", phoneE164: "+5571999990083" }).returning();
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "text", body: "oi", status: "received", createdAt: new Date("2026-08-01T13:00:00Z") });
  await manda([c.id]);
  const ds = await db.select().from(deals).where(eq(deals.contactId, c.id));
  expect(ds).toHaveLength(1);
  expect(await kindOf(ds[0].id)).toBe("atendimento");
  expect(ds[0].followupAttempt).toBe(0);
});
