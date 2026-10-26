import { it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { alerts, contacts, deals, profiles, pushSubscriptions, stages, users } from "./db/schema";
import { sendPushForPendingAlerts } from "./push";
import { resetDb } from "../../test/db";

beforeEach(async () => { await resetDb(); });

async function equipe() {
  const [rec] = await db.insert(profiles).values({ name: "Recepção T", permissions: ["atendimento.ver", "atendimento.todas"] }).returning();
  const [sóSuas] = await db.insert(profiles).values({ name: "Só as suas", permissions: ["atendimento.ver"] }).returning();
  const [pro] = await db.insert(profiles).values({ name: "Profissional T", permissions: ["pro.app"] }).returning();
  const mk = async (name: string, profileId: string, active = true) =>
    (await db.insert(users).values({ name, email: `${name}@c.com`, passwordHash: "x", profileId, active }).returning())[0];
  const u = { sara: await mk("sara", rec.id), cati: await mk("cati", rec.id), lia: await mk("lia", sóSuas.id), jack: await mk("jack", pro.id), off: await mk("off", rec.id, false) };
  for (const x of Object.values(u)) await db.insert(pushSubscriptions).values({ userId: x.id, endpoint: `https://p/${x.name}`, p256dh: "k", auth: "a" });
  const [st] = await db.select().from(stages).limit(1);
  const deal = async (phone: string) => {
    const [ct] = await db.insert(contacts).values({ phoneE164: phone, name: "Maria" }).returning();
    return (await db.insert(deals).values({ contactId: ct.id, stageId: st.id }).returning())[0];
  };
  return { u, deal };
}

it("'Fulana escreveu' vai para a dona e para toda a equipe que vê as conversas das outras (Cati 24/10: 'não aparece notificação')", async () => {
  const { u, deal } = await equipe();
  const d = await deal("+5571999990001");
  await db.insert(alerts).values({ dealId: d.id, userId: u.sara.id, audience: "responsavel", type: "mensagem_cliente", severity: "info", message: "Maria escreveu: “oi”", dedupeKey: "mc1" });
  const to: string[] = [];
  await sendPushForPendingAlerts(async (sub) => { to.push(sub.endpoint); return 201; });
  expect(to.sort()).toEqual(["https://p/cati", "https://p/sara"]);
});

it("conversa sem dona: avisa também quem só vê as suas e as sem dona", async () => {
  const { deal } = await equipe();
  const d = await deal("+5571999990002");
  await db.insert(alerts).values({ dealId: d.id, userId: null, audience: "gestao", type: "mensagem_cliente", severity: "info", message: "Maria escreveu: “oi”", dedupeKey: "mc2" });
  const to: string[] = [];
  await sendPushForPendingAlerts(async (sub) => { to.push(sub.endpoint); return 201; });
  expect(to.sort()).toEqual(["https://p/cati", "https://p/lia", "https://p/sara"]);
});
