import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, clientPhotos, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { cliente, setupAgenda } from "../../../test/agenda-fixtures";
import { mediaDir } from "../whatsapp/media";
import { saveFuncoes } from "./funcoes";
import { addClientPhoto, getPhotoConfig, listClientPhotos, removeClientPhoto, savePhotoConfig } from "./client-photos";

/** Bytes mínimos de JPEG/PNG montados aqui: nenhum código do CRM gera nem altera imagem. */
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const big = (mb: number) => Buffer.concat([JPEG, Buffer.alloc(mb * 1024 * 1024)]);

let u: string, c: string, c2: string, v1: string;
beforeEach(async () => {
  await resetDb();
  const s = await setupAgenda();
  u = s.gestora.id; c = (await cliente("Paula Souza")).contactId; c2 = (await cliente("Marina Lopes")).contactId;
  v1 = (await db.insert(visits).values({ contactId: c, day: "2026-10-14" }).returning())[0].id;
});

describe("adicionar foto", () => {
  it("grava em galeria/<id>.<ext> com o tipo pelos bytes e lista agrupável por visita", async () => {
    const a = await addClientPhoto({ contactId: c, visitId: v1, kind: "antes", data: JPEG }, u);
    const b = await addClientPhoto({ contactId: c, kind: "depois", data: PNG }, u);
    const [row] = await db.select().from(clientPhotos).where(eq(clientPhotos.id, a.id));
    expect(row).toMatchObject({ contactId: c, visitId: v1, kind: "antes", mediaMime: "image/jpeg", mediaPath: `galeria/${a.id}.jpg`, createdBy: u, deletedAt: null });
    expect(existsSync(path.join(mediaDir(), `galeria/${a.id}.jpg`))).toBe(true);
    expect(existsSync(path.join(mediaDir(), `galeria/${b.id}.png`))).toBe(true);
    const list = await listClientPhotos(c);
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.id === a.id)).toEqual({ id: a.id, visitId: v1, day: "2026-10-14", kind: "antes", url: `/api/contatos/${c}/fotos/${a.id}` });
    expect(list.find((p) => p.id === b.id)).toMatchObject({ visitId: null, day: null, kind: "depois" });
    expect(await listClientPhotos(c2)).toEqual([]);
  });
  it("recusa o que não é foto pelos bytes e a que passa de 5 MB", async () => {
    await expect(addClientPhoto({ contactId: c, kind: "antes", data: Buffer.from("<html><script>1</script></html>") }, u)).rejects.toThrow("Envie uma foto");
    await expect(addClientPhoto({ contactId: c, kind: "antes", data: big(5) }, u)).rejects.toThrow("A foto passa de 5 MB");
    await addClientPhoto({ contactId: c, kind: "antes", data: big(4) }, u); // 4 MB passa
    expect(await db.select().from(clientPhotos)).toHaveLength(1);
  });
  it("o tamanho máximo é configurável (maxMb = 1 recusa foto de 2 MB) e fica entre 1 e 20", async () => {
    expect(await getPhotoConfig()).toEqual({ maxMb: 5 });
    await savePhotoConfig({ maxMb: 1 }, u);
    expect(await getPhotoConfig()).toEqual({ maxMb: 1 });
    await expect(addClientPhoto({ contactId: c, kind: "antes", data: big(2) }, u)).rejects.toThrow("A foto passa de 1 MB");
    await savePhotoConfig({ maxMb: 20 }, u);
    await addClientPhoto({ contactId: c, kind: "antes", data: big(6) }, u);
    await expect(savePhotoConfig({ maxMb: 0 }, u)).rejects.toThrow();
    await expect(savePhotoConfig({ maxMb: 21 }, u)).rejects.toThrow();
    await expect(savePhotoConfig({ maxMb: 2.5 }, u)).rejects.toThrow();
    expect(await getPhotoConfig()).toEqual({ maxMb: 20 });
    const log = await db.select().from(auditLog).where(eq(auditLog.entity, "settings"));
    expect(log.some((l) => l.entityId === "fotos_cliente")).toBe(true);
  });
  it("tipo precisa ser antes ou depois; a visita tem que ser da cliente; a cliente tem que existir", async () => {
    await expect(addClientPhoto({ contactId: c, kind: "durante" as never, data: JPEG }, u)).rejects.toThrow();
    await expect(addClientPhoto({ contactId: c2, visitId: v1, kind: "antes", data: JPEG }, u)).rejects.toThrow("Essa visita não é desta cliente.");
    await expect(addClientPhoto({ contactId: c, visitId: "00000000-0000-4000-8000-000000000000", kind: "antes", data: JPEG }, u)).rejects.toThrow("Visita não encontrada.");
    await expect(addClientPhoto({ contactId: "00000000-0000-4000-8000-000000000000", kind: "antes", data: JPEG }, u)).rejects.toThrow("Cliente não encontrada.");
    expect(await db.select().from(clientPhotos)).toEqual([]);
  });
  it("função fotos desligada: recusa no servidor", async () => {
    await saveFuncoes({ fotos: false }, u);
    await expect(addClientPhoto({ contactId: c, kind: "antes", data: JPEG }, u)).rejects.toThrow("desligada");
    expect(await db.select().from(clientPhotos)).toEqual([]);
  });
  it("registra na auditoria quem adicionou, sem caminho nem conteúdo", async () => {
    const a = await addClientPhoto({ contactId: c, visitId: v1, kind: "antes", data: JPEG }, u);
    const [l] = await db.select().from(auditLog).where(eq(auditLog.action, "adicionou_foto_cliente"));
    expect(l).toMatchObject({ userId: u, entity: "contact", entityId: c });
    expect(JSON.stringify(l.data)).toContain(a.id);
    expect(JSON.stringify(l.data)).not.toContain("galeria");
  });
});

describe("apagar foto", () => {
  it("só marca deleted_at (o arquivo fica) e some da lista", async () => {
    const a = await addClientPhoto({ contactId: c, kind: "antes", data: JPEG }, u);
    await removeClientPhoto(a.id, u);
    const [row] = await db.select().from(clientPhotos).where(eq(clientPhotos.id, a.id));
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(row.deletedBy).toBe(u);
    expect(existsSync(path.join(mediaDir(), row.mediaPath))).toBe(true);
    expect(await listClientPhotos(c)).toEqual([]);
    await expect(removeClientPhoto(a.id, u)).rejects.toThrow("Foto não encontrada.");
    await expect(removeClientPhoto("00000000-0000-4000-8000-000000000000", u)).rejects.toThrow("Foto não encontrada.");
  });
  it("função fotos desligada: recusa apagar", async () => {
    const a = await addClientPhoto({ contactId: c, kind: "antes", data: JPEG }, u);
    await saveFuncoes({ fotos: false }, u);
    await expect(removeClientPhoto(a.id, u)).rejects.toThrow("desligada");
  });
});
