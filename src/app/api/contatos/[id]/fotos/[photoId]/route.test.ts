import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/server/db";
import { profiles, users, visits } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { addClientPhoto, removeClientPhoto } from "@/server/domain/client-photos";
import { saveFuncoes } from "@/server/domain/funcoes";
import { resetDb } from "../../../../../../../test/db";
import { cliente, setupAgenda } from "../../../../../../../test/agenda-fixtures";
import { GET } from "./route";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
async function cookieFor(perms: string[]) {
  const [profile] = await db.insert(profiles).values({ name: `Teste ${perms.join(" ")}`, permissions: perms }).returning();
  const [u] = await db.insert(users).values({ name: "Pessoa", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: profile.id }).returning();
  return `cf_session=${(await insertSession(u.id)).token}`;
}
const get = (contactId: string, photoId: string, cookie: string | null) =>
  GET(new NextRequest(`http://localhost/api/contatos/${contactId}/fotos/${photoId}`, { headers: cookie ? { cookie } : {} }), { params: Promise.resolve({ id: contactId, photoId }) });

let u: string, c: string, c2: string, photo: string;
beforeEach(async () => {
  await resetDb();
  const s = await setupAgenda();
  u = s.gestora.id; c = (await cliente("Paula Souza")).contactId; c2 = (await cliente("Marina Lopes")).contactId;
  await db.insert(visits).values({ contactId: c, day: "2026-10-14" });
  photo = (await addClientPhoto({ contactId: c, kind: "antes", data: JPEG }, u)).id;
});

it("sem sessão: 401", async () => { expect((await get(c, photo, null)).status).toBe(401); });
it("com fichas.ver serve a foto, sem cache compartilhado", async () => {
  const r = await get(c, photo, await cookieFor(["fichas.ver"]));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("image/jpeg");
  expect(r.headers.get("cache-control")).toBe("private, no-store");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(Buffer.from(await r.arrayBuffer()).equals(JPEG)).toBe(true);
});
it("contatos.ver sozinho NÃO basta: 403", async () => {
  expect((await get(c, photo, await cookieFor(["contatos.ver"]))).status).toBe(403);
});
it("função fotos desligada: 404", async () => {
  const cookie = await cookieFor(["fichas.ver", "contatos.ver"]);
  await saveFuncoes({ fotos: false }, u);
  expect((await get(c, photo, cookie)).status).toBe(404);
});
it("foto apagada, de outra cliente ou id inválido: 404", async () => {
  const cookie = await cookieFor(["fichas.ver"]);
  expect((await get(c2, photo, cookie)).status).toBe(404);
  expect((await get(c, "nao-e-uuid", cookie)).status).toBe(404);
  await removeClientPhoto(photo, u);
  expect((await get(c, photo, cookie)).status).toBe(404);
});
