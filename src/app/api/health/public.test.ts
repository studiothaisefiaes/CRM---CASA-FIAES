import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { channels, profiles, settings, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { resetDb } from "../../../../test/db";
import { GET } from "./route";

/** Revisão de segurança 17/10 (B5): o /api/health público responde só se está no ar; os detalhes ficam para quem configura o sistema. */
const req = (cookie?: string) => new NextRequest("http://localhost/api/health", { headers: cookie ? { cookie } : {} });
const cookieOf = async (key: string) => {
  const [p] = await db.select().from(profiles).where(eq(profiles.key, key));
  const [u] = await db.insert(users).values({ name: "Pessoa", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: p.id }).returning();
  return `cf_session=${(await insertSession(u.id)).token}`;
};

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Recepção", instanceName: "casa-fiaes-recepcao-x", status: "desconectado" });
});

it("sem sessão: só o status (degraded aqui: número desconectado e sem worker), sem número de WhatsApp, worker nem banco", async () => {
  const res = await GET(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ status: "degraded" });
});

it("atendente logada também vê só o status", async () => {
  expect(await (await GET(req(await cookieOf("atendente")))).json()).toEqual({ status: "degraded" });
});

it("tudo certo: o público vê { status: \"ok\" }", async () => {
  await db.update(channels).set({ status: "conectado" });
  await db.insert(settings).values({ key: "worker_heartbeat", value: new Date().toISOString() }).onConflictDoUpdate({ target: settings.key, set: { value: new Date().toISOString() } });
  expect(await (await GET(req())).json()).toEqual({ status: "ok" });
});

it("quem configura o sistema (gestão) vê os detalhes, como antes", async () => {
  const body = await (await GET(req(await cookieOf("gestao")))).json();
  expect(body).toMatchObject({ status: "degraded", db: true, worker: { ok: false }, whatsapp: [{ name: "Recepção", status: "desconectado" }] });
});
