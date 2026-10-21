import { beforeEach, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/server/db";
import { contacts, deals, messages, profiles, stages, users } from "@/server/db/schema";
import { insertSession } from "@/server/auth/sessions-store";
import { mediaDir } from "@/server/whatsapp/media";
import { __clearThumbMemory } from "@/server/whatsapp/thumbs";
import { resetDb } from "../../../../../test/db";
import { setStrictScope } from "@/server/domain/deal-scope";
import { GET } from "./route";

async function bigPhoto(w = 1600, h = 1200) {
  const raw = Buffer.alloc(w * h * 3);
  let s = 7;
  for (let i = 0; i < raw.length; i++) raw[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
}
// Cabeçalho OggS: o sniff reconhece como áudio.
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(2000, 1)]);

let cookie: string;
async function message(kind: string, file: string, data: Buffer) {
  const [c] = await db.insert(contacts).values({ name: "Ana", phoneE164: `+55719999${Math.floor(Math.random() * 1e5)}` }).returning();
  const [m] = await db.insert(messages).values({ contactId: c.id, direction: "in", kind, status: "received" }).returning();
  await writeFile(path.join(mediaDir(), `${m.id}.${file}`), data);
  await db.update(messages).set({ mediaPath: `${m.id}.${file}` }).where(eq(messages.id, m.id));
  return m.id;
}
const get = (id: string, q = "", headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost/api/media/${id}${q}`, { headers: { cookie, ...headers } }), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDb();
  __clearThumbMemory();
  await mkdir(mediaDir(), { recursive: true });
  const [p] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
  const [u] = await db.insert(users).values({ name: "Pessoa", email: `${Math.random()}@c.com`, passwordHash: "x", profileId: p.id }).returning();
  cookie = `cf_session=${(await insertSession(u.id)).token}`;
});

it("?thumb=1 numa foto: WebP de no máximo 720 px, bem menor, cache imutável, ETag e 304", async () => {
  const big = await bigPhoto();
  const id = await message("image", "jpg", big);
  const r = await get(id, "?thumb=1");
  expect(r.status).toBe(200);
  expect(r.headers.get("content-type")).toBe("image/webp");
  expect(r.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  const body = Buffer.from(await r.arrayBuffer());
  expect(body.length).toBeLessThan(big.length / 3);
  const meta = await sharp(body).metadata();
  expect([meta.width, meta.height]).toEqual([720, 540]);
  const again = await get(id, "?thumb=1", { "if-none-match": r.headers.get("etag")! });
  expect(again.status).toBe(304);
  // Sem thumb: o original (o link "abrir" da conversa).
  const full = await get(id);
  expect(full.headers.get("content-type")).toBe("image/jpeg");
  expect(Buffer.from(await full.arrayBuffer()).equals(big)).toBe(true);
});

it("?thumb=1 em áudio: o arquivo de sempre, e o Range continua 206", async () => {
  const id = await message("audio", "ogg", OGG);
  const r = await get(id, "?thumb=1");
  expect(r.headers.get("content-type")).toBe("audio/ogg");
  expect(Buffer.from(await r.arrayBuffer()).length).toBe(OGG.length);
  const part = await get(id, "?thumb=1", { range: "bytes=0-99" });
  expect(part.status).toBe(206);
  expect(part.headers.get("content-range")).toBe(`bytes 0-99/${OGG.length}`);
});

it("mídia da conversa de outra colega: com a chave estrita ligada 403; desligada (padrão) segue servindo; dona da conversa sempre", async () => {
  const id = await message("audio", "ogg", OGG);
  const [m] = await db.select().from(messages).where(eq(messages.id, id));
  const [bia] = await db.insert(users).values({ name: "Bia", email: "bia@c.com", passwordHash: "x" }).returning();
  const [st] = await db.select().from(stages).limit(1);
  const [d] = await db.insert(deals).values({ contactId: m.contactId, ownerId: bia.id, stageId: st.id }).returning();
  await db.update(messages).set({ dealId: d.id }).where(eq(messages.id, id));
  expect((await get(id)).status).toBe(200);
  await setStrictScope(true, bia.id);
  expect((await get(id)).status).toBe(403);
  const [p] = await db.select().from(profiles).where(eq(profiles.key, "atendente"));
  await db.update(users).set({ profileId: p.id }).where(eq(users.id, bia.id));
  const own = `cf_session=${(await insertSession(bia.id)).token}`;
  expect((await get(id, "", { cookie: own })).status).toBe(200);
});
