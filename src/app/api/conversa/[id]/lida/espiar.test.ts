import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/server/db";
import { alerts, deals, profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { recordInbound } from "@/server/domain/deals";
import { isPeek } from "@/server/domain/seen";
import { resetDb } from "../../../../../../test/db";
import { POST } from "./route";

// Espiar sem assumir (pesquisa 20/10): a gestão abre a conversa da atendente sem tirar o "não lida" nem o aviso dela.
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string, cookie: string) => new NextRequest(`http://localhost/api/conversa/${id}/lida`, { method: "POST", headers: { cookie, "sec-fetch-site": "same-origin" } });
async function person(profileKey: "atendente" | "gestao", name: string) {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, profileKey));
  const [u] = await db.insert(users).values({ name, email: `${Math.random()}@c.com`, passwordHash: "x", profileId: p.id }).returning();
  return { id: u.id, perms: p.permissions, cookie: `cf_session=${(await insertSession(u.id)).token}` };
}
async function lead(phone: string, ownerId: string | null) {
  const r = await recordInbound({ channelId: null, externalId: `E-${phone}`, phoneRaw: phone, body: "oi, quero marcar" });
  if (!("dealId" in r)) throw new Error();
  await db.update(deals).set({ ownerId }).where(eq(deals.id, r.dealId));
  return r.dealId;
}
const seenAt = async (id: string) => (await db.select({ s: deals.seenAt }).from(deals).where(eq(deals.id, id)))[0].s;
beforeEach(async () => { await resetDb(); });

it("gestão espiando a conversa da Sara: continua não lida para ela; responder ou a própria Sara abrir marca", async () => {
  const sara = await person("atendente", "Sara");
  const gestora = await person("gestao", "Gestora");
  const id = await lead("71999991234", sara.id);
  expect(await isPeek(gestora, id)).toBe(true);
  expect(await isPeek(sara, id)).toBe(false);
  const r = await POST(req(id, gestora.cookie), ctx(id));
  expect(await r.json()).toEqual({ ok: true, espiando: true });
  await new Promise((x) => setTimeout(x, 100));
  expect(await seenAt(id)).toBeNull();
  const own = await POST(req(id, sara.cookie), ctx(id));
  expect(await own.json()).toEqual({ ok: true });
  await vi.waitFor(async () => expect(await seenAt(id)).not.toBeNull());
  expect(await db.select().from(alerts).where(and(eq(alerts.dealId, id), eq(alerts.type, "mensagem_cliente"), isNull(alerts.resolvedAt)))).toHaveLength(0);
});

it("conversa sem dona (ou da própria gestora): abrir marca como lida", async () => {
  const gestora = await person("gestao", "Gestora");
  const semDona = await lead("71999991235", null);
  const dela = await lead("71999991236", gestora.id);
  expect(await isPeek(gestora, semDona)).toBe(false);
  expect(await isPeek(gestora, dela)).toBe(false);
  await POST(req(semDona, gestora.cookie), ctx(semDona));
  await vi.waitFor(async () => expect(await seenAt(semDona)).not.toBeNull());
});
