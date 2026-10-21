import { beforeEach, expect, it } from "vitest";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { mediaDir } from "./media";
import { __clearThumbMemory, __thumbStats, AVATAR_THUMB_PX, IMAGE_THUMB_PX, removeThumbs, thumbnail, thumbsDir } from "./thumbs";

// Foto "pesada" de verdade (ruído não comprime): como as fotos do WhatsApp que a Fila pedia no tamanho original.
async function photo(w: number, h: number, seed = 1, format: "jpeg" | "png" | "gif" = "jpeg") {
  const raw = Buffer.alloc(w * h * 3);
  let s = seed;
  for (let i = 0; i < raw.length; i++) raw[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  const img = sharp(raw, { raw: { width: w, height: h, channels: 3 } });
  return format === "png" ? img.png().toBuffer() : format === "gif" ? img.gif().toBuffer() : img.jpeg({ quality: 85 }).toBuffer();
}
const file = (name: string) => path.join(mediaDir(), name);

beforeEach(async () => {
  await rm(mediaDir(), { recursive: true, force: true });
  await mkdir(mediaDir(), { recursive: true });
  __clearThumbMemory();
  __thumbStats.generated = 0;
});

it("foto de perfil: WebP quadrado de no máximo 128 px, bem menor que o original", async () => {
  const src = await photo(640, 480);
  await writeFile(file("avatar-a.jpg"), src);
  const t = await thumbnail(file("avatar-a.jpg"), { px: AVATAR_THUMB_PX, square: true });
  expect(t).not.toBeNull();
  const meta = await sharp(t!.data).metadata();
  expect(meta.format).toBe("webp");
  expect([meta.width, meta.height]).toEqual([128, 128]);
  expect(t!.data.length).toBeLessThan(src.length / 5);
  expect(t!.etag).toMatch(/^W\/"t128-/);
});

it("imagem da conversa: cabe em 720 px sem cortar e sem aumentar a pequena", async () => {
  await writeFile(file("img.jpg"), await photo(1600, 1200));
  const big = await sharp((await thumbnail(file("img.jpg"), { px: IMAGE_THUMB_PX, square: false }))!.data).metadata();
  expect([big.width, big.height]).toEqual([720, 540]);
  await writeFile(file("small.png"), await photo(300, 200, 2, "png"));
  const small = await sharp((await thumbnail(file("small.png"), { px: IMAGE_THUMB_PX, square: false }))!.data).metadata();
  expect([small.width, small.height]).toEqual([300, 200]);
});

it("depois da primeira vez sai da memória e, sem ela, do disco: o sharp não roda de novo", async () => {
  await writeFile(file("avatar-b.jpg"), await photo(640, 640));
  const first = await thumbnail(file("avatar-b.jpg"), { px: 128, square: true });
  expect(__thumbStats.generated).toBe(1);
  const t0 = performance.now();
  const again = await thumbnail(file("avatar-b.jpg"), { px: 128, square: true });
  expect(performance.now() - t0).toBeLessThan(50);
  __clearThumbMemory();
  const fromDisk = await thumbnail(file("avatar-b.jpg"), { px: 128, square: true });
  expect(__thumbStats.generated).toBe(1);
  expect(again!.data.equals(first!.data)).toBe(true);
  expect(fromDisk!.data.equals(first!.data)).toBe(true);
  expect(fromDisk!.etag).toBe(first!.etag);
});

it("foto trocada no mesmo arquivo: miniatura e ETag novas, a velha some do disco", async () => {
  await writeFile(file("avatar-c.jpg"), await photo(640, 640, 3));
  const old = await thumbnail(file("avatar-c.jpg"), { px: 128, square: true });
  await new Promise((r) => setTimeout(r, 15)); // mtime diferente
  await writeFile(file("avatar-c.jpg"), await photo(500, 500, 4));
  const now = await thumbnail(file("avatar-c.jpg"), { px: 128, square: true });
  expect(now!.etag).not.toBe(old!.etag);
  expect(now!.data.equals(old!.data)).toBe(false);
  expect((await readdir(thumbsDir())).filter((f) => f.startsWith("avatar-c.jpg."))).toHaveLength(1);
});

it("não é JPEG/PNG/WebP (GIF animado, texto) ou não existe: null, quem chama serve o original", async () => {
  await writeFile(file("anim.gif"), await photo(64, 64, 5, "gif"));
  await writeFile(file("doc.jpg"), Buffer.from("<html>não é foto</html>"));
  expect(await thumbnail(file("anim.gif"), { px: 128, square: true })).toBeNull();
  expect(await thumbnail(file("doc.jpg"), { px: 128, square: true })).toBeNull();
  expect(await thumbnail(file("nada.jpg"), { px: 128, square: true })).toBeNull();
});

it("rajada do mesmo arquivo gera uma vez só", async () => {
  await writeFile(file("avatar-d.jpg"), await photo(640, 640, 6));
  const all = await Promise.all(Array.from({ length: 10 }, () => thumbnail(file("avatar-d.jpg"), { px: 128, square: true })));
  expect(__thumbStats.generated).toBe(1);
  expect(new Set(all.map((t) => t!.etag)).size).toBe(1);
});

it("removeThumbs apaga as miniaturas do arquivo (retenção) e esquece a da memória", async () => {
  await writeFile(file("m1.jpg"), await photo(800, 600, 7));
  await thumbnail(file("m1.jpg"), { px: 720, square: false });
  await removeThumbs(["m1.jpg"]);
  expect((await readdir(thumbsDir())).filter((f) => f.startsWith("m1.jpg."))).toHaveLength(0);
  await rm(file("m1.jpg"));
  expect(await thumbnail(file("m1.jpg"), { px: 720, square: false })).toBeNull();
});

it("não deu para gravar no disco (cheio, sem permissão): a miniatura sai mesmo assim e não fica .tmp para trás", async () => {
  await writeFile(file("avatar-e.jpg"), await photo(640, 640, 8));
  await writeFile(thumbsDir(), "um arquivo no lugar da pasta"); // mkdir/rename falham
  const t = await thumbnail(file("avatar-e.jpg"), { px: 128, square: true });
  expect(t).not.toBeNull();
  expect((await sharp(t!.data).metadata()).format).toBe("webp");
  expect((await readdir(mediaDir())).filter((f) => f.endsWith(".tmp"))).toHaveLength(0);
});

it("mesmo nome em pastas diferentes: cada arquivo tem a sua miniatura e uma não apaga a outra", async () => {
  await mkdir(path.join(mediaDir(), "avatars"), { recursive: true });
  await writeFile(file("p.jpg"), await photo(300, 300, 9));
  await writeFile(file("avatars/p.jpg"), await photo(300, 300, 10));
  const a = await thumbnail(file("p.jpg"), { px: 128, square: true });
  const b = await thumbnail(file("avatars/p.jpg"), { px: 128, square: true });
  expect(a!.etag).not.toBe(b!.etag);
  expect(a!.data.equals(b!.data)).toBe(false);
  expect((await readdir(thumbsDir())).filter((f) => f.startsWith("p.jpg."))).toHaveLength(2);
});
