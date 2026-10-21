import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { contacts, deals, profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { recordInbound } from "@/server/domain/deals";
import { OUT_OF_SCOPE, setStrictScope } from "@/server/domain/deal-scope";
import { conversationFor } from "@/server/queries/conversation";
import { parseWithDates } from "@/lib/json-dates";
import { resetDb } from "../../../../../test/db";
import { GET } from "./route";
import { POST as LIDA } from "./lida/route";
import { GET as PROXIMO } from "./proximo/route";

async function session(perms: string[] | "atendente" | "gestao") {
  const [profile] = typeof perms === "string"
    ? await db.select().from(profiles).where(eq(profiles.key, perms))
    : await db.insert(profiles).values({ name: `Teste ${perms.join(" ")}`, permissions: perms }).returning();
  const [u] = await db.insert(users).values({ name: "Pessoa Teste", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: profile.id }).returning();
  const token = (await insertSession(u.id)).token;
  return { cookie: `cf_session=${token}`, userId: u.id };
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (path: string, cookie: string | null, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost${path}`, { method: init.method ?? "GET", headers: { ...(cookie ? { cookie } : {}), ...init.headers } });
const lead = async (phone: string, body = "oi") => {
  const r = await recordInbound({ channelId: null, externalId: `L-${phone}-${Math.random()}`, phoneRaw: phone, pushName: "Cliente Teste", body });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};

beforeEach(async () => { await resetDb(); });

it("GET /api/conversa/[id]: o mesmo conteúdo da action, com as datas como Date, sem cache compartilhado", async () => {
  const { cookie, userId } = await session("atendente");
  const id = await lead("71999990001", "Quero agendar");
  const res = await GET(req(`/api/conversa/${id}`, cookie), ctx(id));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  const body = parseWithDates<Awaited<ReturnType<typeof conversationFor>>>(await res.text());
  if (!body.ok) throw new Error(body.error);
  expect(body.data.deal.id).toBe(id);
  expect(body.data.deal.createdAt).toBeInstanceOf(Date);
  expect(body.data.messages.at(-1)!.createdAt).toBeInstanceOf(Date);
  expect(body.data.messages.at(-1)!.body).toBe("Quero agendar");
  expect(body.viewer.id).toBe(userId);
  // Igual ao que a Server Action devolve (mesma função), depois de ida e volta pelo JSON.
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  const direct = await conversationFor({ id: u.id, name: u.name, email: u.email, profileId: u.profileId, profileName: "Atendente", perms: body.viewer.perms, availability: u.availability }, id);
  expect(JSON.parse(JSON.stringify(body))).toEqual(JSON.parse(JSON.stringify(direct)));
});

it("GET /api/conversa/[id]: sem sessão 401, sem atendimento.ver 403, id inválido 400, lead que não existe 404 — sempre com o texto para a tela", async () => {
  const id = await lead("71999990002");
  const noSession = await GET(req(`/api/conversa/${id}`, null), ctx(id));
  expect(noSession.status).toBe(401);
  expect(await noSession.json()).toEqual({ ok: false, error: "Sua sessão expirou. Entre de novo." });
  const { cookie: semPerm } = await session(["relatorios.ver"]);
  const forbidden = await GET(req(`/api/conversa/${id}`, semPerm), ctx(id));
  expect(forbidden.status).toBe(403);
  expect((await forbidden.json()).ok).toBe(false);
  const { cookie } = await session("atendente");
  const bad = await GET(req(`/api/conversa/xyz`, cookie), ctx("xyz"));
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ ok: false, error: "Não foi possível abrir a conversa. Tente de novo." });
  const gone = "00000000-0000-4000-8000-000000000000";
  const nf = await GET(req(`/api/conversa/${gone}`, cookie), ctx(gone));
  expect(nf.status).toBe(404);
  expect(await nf.json()).toEqual({ ok: false, error: "Essa conversa não existe mais." });
});

it("GET /api/conversa/[id]: valores em R$ só para quem vê dinheiro (a mesma regra da action)", async () => {
  const id = await lead("71999990003");
  await db.update(deals).set({ valueCents: 38000 }).where(eq(deals.id, id));
  const { cookie: gestao } = await session("gestao");
  const { cookie: semDinheiro } = await session(["atendimento.ver"]);
  const g = parseWithDates<{ ok: true; data: { deal: { valueCents: number | null } } }>(await (await GET(req(`/api/conversa/${id}`, gestao), ctx(id))).text());
  const s = parseWithDates<{ ok: true; data: { deal: { valueCents: number | null }; money: boolean } }>(await (await GET(req(`/api/conversa/${id}`, semDinheiro), ctx(id))).text());
  expect(g.data.deal.valueCents).toBe(38000);
  expect(s.data.deal.valueCents).toBeNull();
  expect(s.data.money).toBe(false);
});

it("POST /api/conversa/[id]/lida: marca a conversa como vista; exige sessão e atendimento.ver; recusa pedido de outro site", async () => {
  const id = await lead("71999990004");
  expect((await LIDA(req(`/api/conversa/${id}/lida`, null, { method: "POST" }), ctx(id))).status).toBe(401);
  const { cookie: semPerm } = await session(["relatorios.ver"]);
  expect((await LIDA(req(`/api/conversa/${id}/lida`, semPerm, { method: "POST" }), ctx(id))).status).toBe(403);
  const { cookie } = await session("atendente");
  expect((await LIDA(req(`/api/conversa/${id}/lida`, cookie, { method: "POST", headers: { "sec-fetch-site": "cross-site" } }), ctx(id))).status).toBe(403);
  const ok = await LIDA(req(`/api/conversa/${id}/lida`, cookie, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }), ctx(id));
  expect(ok.status).toBe(200);
  expect(await ok.json()).toEqual({ ok: true });
  await vi.waitFor(async () => {
    const [d] = await db.select({ seenAt: deals.seenAt }).from(deals).where(eq(deals.id, id));
    expect(d.seenAt).not.toBeNull();
  });
});

it("GET /api/conversa/[id]/proximo: quem espera há mais tempo, sem o lead atual, com o nome", async () => {
  const { cookie } = await session("gestao");
  const a = await lead("71999990005");
  const b = await lead("71999990006");
  await db.update(contacts).set({ name: "Bruna Lemos" }).where(eq(contacts.phoneE164, "+5571999990006"));
  const r = await (await PROXIMO(req(`/api/conversa/${a}/proximo`, cookie), ctx(a))).json();
  expect(r).toEqual({ ok: true, id: b, name: "Bruna Lemos" });
  expect((await PROXIMO(req(`/api/conversa/${a}/proximo`, null), ctx(a))).status).toBe(401);
});

describe("escopo da conversa (revisão de segurança 17/10, M1)", () => {
  const owned = async (phone: string, ownerId: string | null) => { const id = await lead(phone); await db.update(deals).set({ ownerId }).where(eq(deals.id, id)); return id; };
  const ligada = async () => setStrictScope(true, (await session("gestao")).userId);

  it("GET: atendente com a conversa de uma colega recebe 403 com o texto para a tela; sem dono e a própria abrem", async () => {
    await ligada();
    const { cookie } = await session("atendente");
    const { userId: colega } = await session("atendente");
    const daColega = await owned("71999990101", colega);
    const res = await GET(req(`/api/conversa/${daColega}`, cookie), ctx(daColega));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: OUT_OF_SCOPE });
    const semDono = await owned("71999990102", null);
    expect((await GET(req(`/api/conversa/${semDono}`, cookie), ctx(semDono))).status).toBe(200);
  });

  it("GET: a gestão abre a conversa de qualquer pessoa (nada muda para ela)", async () => {
    await ligada();
    const { cookie } = await session("gestao");
    const { userId: atendente } = await session("atendente");
    const id = await owned("71999990103", atendente);
    const res = await GET(req(`/api/conversa/${id}`, cookie), ctx(id));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  it("chave desligada (o padrão): a atendente abre a conversa de uma colega, como antes", async () => {
    const { cookie } = await session("atendente");
    const { userId: colega } = await session("atendente");
    const id = await owned("71999990105", colega);
    expect((await GET(req(`/api/conversa/${id}`, cookie), ctx(id))).status).toBe(200);
  });

  it("POST lida: atendente não marca como vista a conversa de uma colega", async () => {
    await ligada();
    const { cookie } = await session("atendente");
    const { userId: colega } = await session("atendente");
    const id = await owned("71999990104", colega);
    const r = await LIDA(req(`/api/conversa/${id}/lida`, cookie, { method: "POST", headers: { "sec-fetch-site": "same-origin" } }), ctx(id));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ ok: false, error: OUT_OF_SCOPE });
    const [d] = await db.select({ seenAt: deals.seenAt }).from(deals).where(eq(deals.id, id));
    expect(d.seenAt).toBeNull();
  });
});
