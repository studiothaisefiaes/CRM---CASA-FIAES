import { it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { messages, contacts } from "../db/schema";
import { purgeExpiredMedia } from "./retention"; import { resetDb } from "../../../test/db";
const DIR = mkdtempSync(path.join(tmpdir(), "cf-ret-")); process.env.MEDIA_DIR = DIR;
const OUTSIDE = mkdtempSync(path.join(tmpdir(), "cf-fora-"));
const NOW = new Date("2026-10-09T12:00:00Z");
beforeEach(async () => { await resetDb(); });
const mk = async () => (await db.insert(contacts).values({ phoneE164: "+5571999990009" }).returning())[0];
it("apaga arquivo com mais de 12 meses e mantém o registro", async () => {
  const c = await mk();
  writeFileSync(path.join(DIR, "old.jpg"), "x"); writeFileSync(path.join(DIR, "new.jpg"), "y");
  await db.insert(messages).values([
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "old.jpg", createdAt: new Date("2025-09-01T12:00:00Z") },
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "new.jpg", createdAt: new Date("2026-09-01T12:00:00Z") }]);
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 1 });
  expect(existsSync(path.join(DIR, "old.jpg"))).toBe(false); expect(existsSync(path.join(DIR, "new.jpg"))).toBe(true);
  const all = await db.select().from(messages);
  expect(all.length).toBe(2);
  const old = all.find((m) => m.createdAt.getUTCFullYear() === 2025)!;
  expect(old.mediaPurgedAt).not.toBeNull(); expect(old.mediaPath).toBeNull();
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 0 }); // idempotente
});
it("'nunca' (null) não apaga nada", async () => {
  const c = await mk(); writeFileSync(path.join(DIR, "keep.jpg"), "x");
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: "keep.jpg", createdAt: new Date("2020-01-01T12:00:00Z") });
  expect(await purgeExpiredMedia(NOW, null)).toEqual({ purged: 0 });
  expect(existsSync(path.join(DIR, "keep.jpg"))).toBe(true);
});
it("caminho fora de MEDIA_DIR é ignorado (.. e absoluto)", async () => {
  const c = await mk(); const target = path.join(OUTSIDE, "segredo.txt"); writeFileSync(target, "s");
  mkdirSync(path.join(DIR, "sub"), { recursive: true });
  await db.insert(messages).values([
    { contactId: c.id, direction: "in", kind: "image", mediaPath: path.relative(DIR, target), createdAt: new Date("2020-01-01T12:00:00Z") },
    { contactId: c.id, direction: "in", kind: "image", mediaPath: target, createdAt: new Date("2020-01-01T12:00:00Z") }]);
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 0 });
  expect(existsSync(target)).toBe(true);
  expect((await db.select().from(messages).where(eq(messages.contactId, c.id))).every((m) => m.mediaPurgedAt === null)).toBe(true);
});
it("arquivo que já sumiu do disco só é marcado", async () => {
  const c = await mk();
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: "sumiu.jpg", createdAt: new Date("2020-01-01T12:00:00Z") });
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 1 });
});
