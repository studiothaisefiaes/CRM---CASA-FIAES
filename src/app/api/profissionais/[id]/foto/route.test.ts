import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { professionals, profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { resetDb } from "../../../../../../test/db";
import { GET, POST } from "./route";

const png = async () => { const { default: sharp } = await import("sharp"); return sharp({ create: { width: 64, height: 64, channels: 3, background: "#3f7d4f" } }).png().toBuffer(); };
async function session(perms: string[] | "atendente") {
  const [profile] = perms === "atendente"
    ? await db.select().from(profiles).where(eq(profiles.key, "atendente"))
    : await db.insert(profiles).values({ name: `Teste ${perms.join(" ")}`, permissions: perms }).returning();
  const [u] = await db.insert(users).values({ name: "Pessoa", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: profile.id }).returning();
  return `cf_session=${(await insertSession(u.id)).token}`;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
async function post(id: string, cookie: string | null, data?: Uint8Array) {
  const fd = new FormData();
  if (data) fd.append("foto", new File([new Uint8Array(data)], "minha-foto.png"));
  return POST(new NextRequest(`http://localhost/api/profissionais/${id}/foto`, { method: "POST", body: fd, headers: cookie ? { cookie } : {} }), ctx(id));
}
const get = (id: string, cookie: string, q = "") => GET(new NextRequest(`http://localhost/api/profissionais/${id}/foto${q}`, { headers: { cookie } }), ctx(id));

let proId: string;
beforeEach(async () => { await resetDb(); proId = (await db.insert(professionals).values({ name: "Ana" }).returning())[0].id; });

it("envio: sem sessão 401; sem config.diaadia nem agenda.marcar 403; a recepção (agenda.marcar) envia", async () => {
  expect((await post(proId, null, await png())).status).toBe(401);
  expect((await post(proId, await session(["atendimento.ver"]), await png())).status).toBe(403);
  const res = await post(proId, await session("atendente"), await png());
  expect(res.status).toBe(200);
  expect((await res.json()).photoVersion).toMatch(/^\d+$/);
});

it("envio sem arquivo ou de outro tipo: 400 com o texto para a tela; nada de caminho do disco na resposta", async () => {
  const c = await session("atendente");
  expect(await (await post(proId, c)).json()).toEqual({ error: "Escolha uma foto." });
  const r = await post(proId, c, new TextEncoder().encode("<html>oi</html>"));
  expect(r.status).toBe(400);
  expect(await r.json()).toEqual({ error: "Use uma foto JPG, PNG ou WEBP." });
});

it("leitura: quem vê o atendimento recebe a miniatura em cache longo; sem foto 404; sem permissão 403", async () => {
  const c = await session("atendente");
  const { photoVersion } = await (await post(proId, c, await png())).json();
  const res = await get(proId, c, `?v=${photoVersion}`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/webp");
  expect(res.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect((await get(proId, c, `?v=${photoVersion}&tam=grande`)).headers.get("content-type")).toBe("image/png");
  const other = (await db.insert(professionals).values({ name: "Bia" }).returning())[0].id;
  expect((await get(other, c)).status).toBe(404);
  expect((await get(proId, await session(["relatorios.ver"]))).status).toBe(403);
});
