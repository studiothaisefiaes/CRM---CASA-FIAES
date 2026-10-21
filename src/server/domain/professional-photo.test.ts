import { beforeEach, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, professionals, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { mediaDir } from "../whatsapp/media";
import { readProfessionalPhoto, saveProfessionalPhoto } from "./professional-photo";

const image = async (format: "png" | "jpeg" | "webp", w = 400, h = 300) => {
  const { default: sharp } = await import("sharp");
  return sharp({ create: { width: w, height: h, channels: 3, background: "#8e4a7e" } })[format]().toBuffer();
};
let proId: string, userId: string;
beforeEach(async () => {
  await resetDb();
  await rm(path.join(mediaDir(), "profissionais"), { recursive: true, force: true });
  proId = (await db.insert(professionals).values({ name: "Ana" }).returning())[0].id;
  userId = (await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
});

it("guarda a original e a miniatura quadrada de 256 px em WEBP, sem expor o caminho; registra quem trocou", async () => {
  const { photoVersion } = await saveProfessionalPhoto(proId, await image("png"), userId, new Date(1_760_000_000_000));
  expect(photoVersion).toBe("1760000000000");
  const [p] = await db.select().from(professionals).where(eq(professionals.id, proId));
  expect(p.photoPath).toBe(`profissionais/${proId}/1760000000000.png`);
  const q = await readProfessionalPhoto(proId, "q");
  expect(q?.mime).toBe("image/webp");
  const { default: sharp } = await import("sharp");
  expect(await sharp(q!.data).metadata()).toMatchObject({ width: 256, height: 256, format: "webp" });
  expect((await readProfessionalPhoto(proId, "full"))?.mime).toBe("image/png");
  expect(await db.select().from(auditLog).where(eq(auditLog.action, "profissional_foto"))).toHaveLength(1);
});

it("recusa acima de 5 MB, vazio e o que não é JPG, PNG ou WEBP (pelo conteúdo, não pelo nome)", async () => {
  const big = Buffer.concat([await image("png"), Buffer.alloc(5 * 1024 * 1024)]);
  await expect(saveProfessionalPhoto(proId, big, userId)).rejects.toThrow("A foto passa de 5 MB. Escolha uma menor.");
  await expect(saveProfessionalPhoto(proId, new Uint8Array(), userId)).rejects.toThrow("Escolha uma foto.");
  await expect(saveProfessionalPhoto(proId, Buffer.from("GIF89a……"), userId)).rejects.toThrow("Use uma foto JPG, PNG ou WEBP.");
  await expect(saveProfessionalPhoto(proId, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), userId)).rejects.toThrow("Use uma foto JPG, PNG ou WEBP.");
  await expect(saveProfessionalPhoto("00000000-0000-4000-8000-000000000000", await image("jpeg"), userId)).rejects.toThrow("Profissional não encontrada.");
  expect((await db.select().from(professionals).where(eq(professionals.id, proId)))[0].photoPath).toBeNull();
});

it("trocar a foto apaga a anterior do disco; sem miniatura (sharp ausente), a leitura pequena devolve a original", async () => {
  await saveProfessionalPhoto(proId, await image("jpeg"), userId, new Date(1000));
  const first = path.join(mediaDir(), "profissionais", proId, "1000.jpg");
  expect(existsSync(first)).toBe(true);
  await saveProfessionalPhoto(proId, await image("webp"), userId, new Date(2000));
  expect(existsSync(first)).toBe(false);
  expect(existsSync(path.join(mediaDir(), "profissionais", proId, "1000-q.webp"))).toBe(false);
  await rm(path.join(mediaDir(), "profissionais", proId, "2000-q.webp"));
  expect((await readProfessionalPhoto(proId, "q"))?.name).toBe("2000.webp");
});
