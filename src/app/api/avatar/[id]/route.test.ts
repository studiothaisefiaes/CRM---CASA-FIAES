import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { contacts, profiles, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { mediaDir } from "@/server/whatsapp/media";
import { resetDb } from "../../../../../test/db";
import sharp from "sharp";
import { __clearThumbMemory } from "@/server/whatsapp/thumbs";
import { GET } from "./route";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
async function cookieFor(perms: string[] | "atendente") {
  const [profile] = perms === "atendente"
    ? await db.select().from(profiles).where(eq(profiles.key, "atendente"))
    : await db.insert(profiles).values({ name: `Teste ${perms.join(" ")}`, permissions: perms }).returning();
  const [u] = await db.insert(users).values({ name: "Pessoa", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: profile.id }).returning();
  return `cf_session=${(await insertSession(u.id)).token}`;
}
const get = (id: string, cookie: string | null, q = "", headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/api/avatar/${id}${q}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } }), { params: Promise.resolve({ id }) });

// Foto de verdade (640 px, ruído: não comprime), como as do WhatsApp.
async function bigPhoto(seed = 1) {
  const raw = Buffer.alloc(640 * 640 * 3);
  let s = seed;
  for (let i = 0; i < raw.length; i++) raw[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  return sharp(raw, { raw: { width: 640, height: 640, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}

let contactId: string;
beforeEach(async () => {
  __clearThumbMemory();
  await resetDb();
  const [c] = await db.insert(contacts).values({ name: "Ana", phoneE164: "+5571999990101" }).returning();
  contactId = c.id;
  await mkdir(mediaDir(), { recursive: true });
  await writeFile(path.join(mediaDir(), `avatar-${c.id}.jpg`), JPEG);
  await db.update(contacts).set({ avatarPath: `avatar-${c.id}.jpg`, avatarCheckedAt: new Date() }).where(eq(contacts.id, c.id));
});

it("com versão (?v=): cache de 1 ano, imutável; sem versão: 1 dia (a foto troca na mesma URL)", async () => {
  const c = await cookieFor("atendente");
  const v = await get(contactId, c, "?v=123&full=1");
  expect(v.status).toBe(200);
  expect(v.headers.get("content-type")).toBe("image/jpeg");
  expect(v.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect((await get(contactId, c, "?full=1")).headers.get("cache-control")).toBe("private, max-age=86400");
});

it("padrão: a miniatura WebP de 128 px (bem menor), com o mesmo cache pela versão, ETag própria e 304", async () => {
  const big = await bigPhoto();
  await writeFile(path.join(mediaDir(), `avatar-${contactId}.jpg`), big);
  const c = await cookieFor("atendente");
  const r = await get(contactId, c, "?v=123");
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("image/webp");
  expect(r.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  const body = Buffer.from(await r.arrayBuffer());
  expect(body.length).toBeLessThan(big.length / 10);
  expect(Number(r.headers.get("content-length"))).toBe(body.length);
  const meta = await sharp(body).metadata();
  expect([meta.format, meta.width, meta.height]).toEqual(["webp", 128, 128]);
  expect((await get(contactId, c)).headers.get("cache-control")).toBe("private, max-age=86400");
  const etag = r.headers.get("etag")!;
  expect(etag).toMatch(/^W\/"t128-/);
  const again = await get(contactId, c, "?v=123", { "if-none-match": etag });
  expect(again.status).toBe(304);
  // O original continua por ?full=1 (foto ampliada), com a ETag do arquivo.
  const full = await get(contactId, c, "?v=123&full=1");
  expect(full.headers.get("content-type")).toBe("image/jpeg");
  expect(Buffer.from(await full.arrayBuffer()).equals(big)).toBe(true);
  expect(full.headers.get("etag")).not.toBe(etag);
});

it("depois da primeira vez, a foto sai em menos de 50 ms", async () => {
  await writeFile(path.join(mediaDir(), `avatar-${contactId}.jpg`), await bigPhoto(2));
  const c = await cookieFor("atendente");
  await get(contactId, c, "?v=1"); // gera e guarda
  const times: number[] = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); const r = await get(contactId, c, "?v=1"); await r.arrayBuffer(); times.push(performance.now() - t); }
  expect(Math.min(...times)).toBeLessThan(50);
});

it("arquivo que não é foto no lugar da foto: sai o original, como antes (download binário, nunca HTML)", async () => {
  await writeFile(path.join(mediaDir(), `avatar-${contactId}.jpg`), Buffer.from("<html><script>x</script></html>"));
  const r = await get(contactId, await cookieFor("atendente"));
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("application/octet-stream");
});

it("ETag: o mesmo arquivo devolve 304 sem corpo", async () => {
  const c = await cookieFor("atendente");
  const first = await get(contactId, c, "?full=1");
  const etag = first.headers.get("etag");
  expect(etag).toBeTruthy();
  const again = await get(contactId, c, "?full=1", { "if-none-match": etag! });
  expect(again.status).toBe(304);
  expect(await again.text()).toBe("");
  expect(again.headers.get("etag")).toBe(etag);
  // Foto nova no disco: outra ETag, 200.
  await writeFile(path.join(mediaDir(), `avatar-${contactId}.jpg`), new Uint8Array([...JPEG.slice(0, -2), 0, 0xff, 0xd9]));
  expect((await get(contactId, c, "?full=1", { "if-none-match": etag! })).status).toBe(200);
});

it("sem sessão 401, sem permissão 403, sem foto 404", async () => {
  expect((await get(contactId, null)).status).toBe(401);
  expect((await get(contactId, await cookieFor(["relatorios.ver"]))).status).toBe(403);
  const [other] = await db.insert(contacts).values({ name: "Bia", phoneE164: "+5571999990102" }).returning();
  expect((await get(other.id, await cookieFor("atendente"))).status).toBe(404);
});
