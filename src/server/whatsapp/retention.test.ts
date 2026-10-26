import { it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from "node:fs"; import { tmpdir } from "node:os"; import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db"; import { messages, contacts } from "../db/schema";
import { purgeExpiredMedia, runMediaRetention } from "./retention"; import { resetDb } from "../../../test/db";
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
it("job diário sem prazo escolhido em Configurações: não apaga nada e registra que a retenção está desligada", async () => {
  const c = await mk(); writeFileSync(path.join(DIR, "antiga.jpg"), "x");
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: "antiga.jpg", createdAt: new Date("2020-01-01T12:00:00Z") });
  const logs: unknown[][] = []; const orig = console.log; console.log = (...a: unknown[]) => { logs.push(a); };
  try { expect(await runMediaRetention(NOW)).toEqual({ purged: 0, off: true }); } finally { console.log = orig; }
  expect(existsSync(path.join(DIR, "antiga.jpg"))).toBe(true);
  expect(logs.flat().join(" ")).toMatch(/retenção de mídia\] desligada/i);
});
it("job diário com prazo escolhido pela gestão: apaga só o que passou do prazo", async () => {
  const { settings } = await import("../db/schema");
  await db.insert(settings).values({ key: "retencao_midia_meses", value: 12 });
  const c = await mk(); writeFileSync(path.join(DIR, "velha.jpg"), "x");
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: "velha.jpg", createdAt: new Date("2025-01-01T12:00:00Z") });
  expect(await runMediaRetention(NOW)).toEqual({ purged: 1, off: false });
  expect(existsSync(path.join(DIR, "velha.jpg"))).toBe(false);
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
  // marcadas (nunca servidas) e sem apagar nada fora; não ocupam mais a janela
  expect((await db.select().from(messages).where(eq(messages.contactId, c.id))).every((m) => m.mediaPurgedAt !== null)).toBe(true);
});
it("arquivo que já sumiu do disco só é marcado", async () => {
  const c = await mk();
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: "sumiu.jpg", createdAt: new Date("2020-01-01T12:00:00Z") });
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 1 });
});
it("roda em lotes até esvaziar; o teto de lotes limita a execução", async () => {
  const c = await mk();
  for (let i = 0; i < 5; i++) { writeFileSync(path.join(DIR, `l${i}.jpg`), "x"); await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: `l${i}.jpg`, createdAt: new Date(`2020-01-0${i + 1}T12:00:00Z`) }); }
  expect(await purgeExpiredMedia(NOW, 12, { batch: 2, maxBatches: 2 })).toEqual({ purged: 4 });
  expect(await purgeExpiredMedia(NOW, 12, { batch: 2 })).toEqual({ purged: 1 });
});
it("caminhos inválidos não travam a janela: os válidos depois deles são apagados", async () => {
  const c = await mk(); writeFileSync(path.join(DIR, "ok.jpg"), "x");
  await db.insert(messages).values([
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "../x1", createdAt: new Date("2019-01-01T12:00:00Z") },
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "../x2", createdAt: new Date("2019-01-02T12:00:00Z") },
    { contactId: c.id, direction: "in", kind: "image", mediaPath: "ok.jpg", createdAt: new Date("2020-01-01T12:00:00Z") }]);
  expect(await purgeExpiredMedia(NOW, 12, { batch: 2, maxBatches: 2 })).toEqual({ purged: 1 });
  expect(existsSync(path.join(DIR, "ok.jpg"))).toBe(false);
});
it("áudio vencido apaga também a cópia .m4a", async () => {
  const c = await mk();
  writeFileSync(path.join(DIR, "voz.ogg"), "o"); writeFileSync(path.join(DIR, "voz.m4a"), "m");
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "audio", mediaPath: "voz.ogg", playbackPath: "voz.m4a", createdAt: new Date("2025-01-01T12:00:00Z") });
  await purgeExpiredMedia(NOW, 12);
  expect(existsSync(path.join(DIR, "voz.ogg"))).toBe(false);
  expect(existsSync(path.join(DIR, "voz.m4a"))).toBe(false);
  const [m] = await db.select().from(messages);
  expect(m.playbackPath).toBeNull();
});
it("mídia vencida apaga também as miniaturas dela (thumbs/), e só as dela", async () => {
  const c = await mk();
  writeFileSync(path.join(DIR, "foto.jpg"), "x");
  mkdirSync(path.join(DIR, "thumbs"), { recursive: true });
  writeFileSync(path.join(DIR, "thumbs", "foto.jpg.abc123.720.webp"), "t");
  writeFileSync(path.join(DIR, "thumbs", "foto.jpg2.abc123.720.webp"), "outra");
  await db.insert(messages).values({ contactId: c.id, direction: "in", kind: "image", mediaPath: "foto.jpg", createdAt: new Date("2025-01-01T12:00:00Z") });
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 1 });
  expect(existsSync(path.join(DIR, "thumbs", "foto.jpg.abc123.720.webp"))).toBe(false);
  expect(existsSync(path.join(DIR, "thumbs", "foto.jpg2.abc123.720.webp"))).toBe(true);
});
it("o arquivo de uma resposta pronta (resposta-*) nunca é apagado: várias mensagens apontam para ele", async () => {
  const c = await mk(); writeFileSync(path.join(DIR, "resposta-abc.mp4"), "v");
  await db.insert(messages).values({ contactId: c.id, direction: "out", kind: "video", mediaPath: "resposta-abc.mp4", createdAt: new Date("2020-01-01T12:00:00Z") });
  expect(await purgeExpiredMedia(NOW, 12)).toEqual({ purged: 0 });
  expect(existsSync(path.join(DIR, "resposta-abc.mp4"))).toBe(true);
  expect((await db.select().from(messages).where(eq(messages.contactId, c.id)))[0]).toMatchObject({ mediaPath: "resposta-abc.mp4", mediaPurgedAt: null });
});
