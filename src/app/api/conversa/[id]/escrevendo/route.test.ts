import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { recordInbound } from "@/server/domain/deals";
import { resetDb } from "../../../../../../test/db";

const { emitted } = vi.hoisted(() => ({ emitted: [] as { type: string; data: Record<string, unknown> }[] }));
vi.mock("@/server/domain/events", async (orig) => ({ ...(await orig<typeof import("@/server/domain/events")>()), emit: async (type: string, data: Record<string, unknown> = {}) => { emitted.push({ type, data }); } }));
import { POST } from "./route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (id: string, cookie: string | null) => new NextRequest(`http://localhost/api/conversa/${id}/escrevendo`, { method: "POST", headers: cookie ? { cookie } : {} });
beforeEach(async () => { await resetDb(); emitted.length = 0; });

it("POST escrevendo: repassa quem e em qual conversa (nunca texto); sem sessão 401", async () => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
  const [u] = await db.insert(users).values({ name: "SARA SANTOS", email: "s@c.com", passwordHash: "x", profileId: p.id }).returning();
  const cookie = `cf_session=${(await insertSession(u.id)).token}`;
  const r = await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71999990009", body: "oi" });
  if (!("dealId" in r)) throw new Error();
  emitted.length = 0;
  const res = await POST(req(r.dealId, cookie), ctx(r.dealId));
  expect(res.status).toBe(200);
  expect(emitted).toEqual([{ type: "escrevendo", data: { dealId: r.dealId, userId: u.id, nome: "Sara" } }]);
  expect((await POST(req(r.dealId, null), ctx(r.dealId))).status).toBe(401);
  expect((await POST(req("nao-e-uuid", cookie), ctx("nao-e-uuid"))).status).toBe(400);
});
