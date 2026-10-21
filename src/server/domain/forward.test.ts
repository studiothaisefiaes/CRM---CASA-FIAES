import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { save } from "../whatsapp/media";
import { resetDb } from "../../../test/db";
import { saveFuncao } from "./funcoes";
import { FORWARD_MAX, forwardMessage } from "./forward";

type Media = { name: string; mime: string; mediatype: string; caption: string | null };
const texts: { to: string; text: string }[] = [];
const medias: { to: string; caption: string | null }[] = [];
const audios: string[] = [];
const failFor = new Set<string>();
let n = 0;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, to: string, text: string) => { if (failFor.has(to)) throw new Error("falhou"); texts.push({ to, text }); return { externalId: `T${++n}` }; },
  sendMedia: async (_i: string, to: string, f: Media, caption: string | null) => { if (failFor.has(to)) throw new Error("falhou"); medias.push({ to, caption }); return { externalId: `M${++n}` }; },
  sendAudio: async (_i: string, to: string) => { audios.push(to); return { externalId: `A${++n}` }; },
};
// PNG mínimo válido (assinatura + IHDR); o servidor reconhece o tipo pelos bytes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let uid = "", gestor = "", chId = "", srcDeal = "", photoId = "", textId = "";
const dealOf = async (phone: string, name: string, kind: "cliente" | "equipe" = "cliente") => {
  const r = await recordInbound({ channelId: chId, externalId: `IN-${phone}`, phoneRaw: phone, body: "oi", pushName: name });
  if (!("dealId" in r)) throw new Error("sem conversa");
  await db.update(contacts).set({ name, kind }).where(eq(contacts.id, (await db.select().from(deals).where(eq(deals.id, r.dealId)))[0].contactId));
  return r.dealId;
};

beforeEach(async () => {
  texts.length = 0; medias.length = 0; audios.length = 0; failFor.clear(); n = 0;
  await resetDb(); setWhatsappProvider(fake as never);
  [{ id: uid }] = await db.insert(users).values({ name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: gestor }] = await db.insert(users).values({ name: "Thaise", email: "t@c.com", role: "gestor", passwordHash: "x" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  srcDeal = await dealOf("71999995555", "Maria Souza");
  const [d] = await db.select().from(deals).where(eq(deals.id, srcDeal));
  await save("fwd-foto.png", PNG);
  [{ id: photoId }] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, channelId: chId, direction: "in", kind: "image", body: null, mediaPath: "fwd-foto.png", mediaMime: "image/png", status: "received", externalId: "IMG1", createdAt: new Date("2026-10-20T13:00:00Z") }).returning({ id: messages.id });
  [{ id: textId }] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, channelId: chId, direction: "in", kind: "text", body: "Quero horário sexta", status: "received", externalId: "TX1", createdAt: new Date("2026-10-20T13:05:00Z") }).returning({ id: messages.id });
});
afterEach(() => setWhatsappProvider(null));

describe("encaminhar", () => {
  it("para conversa de Equipe vai com o cabeçalho com o nome da cliente e o horário", async () => {
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    const r = await forwardMessage(photoId, [eq1], uid);
    expect(r).toEqual({ sent: 1, failed: [] });
    expect(medias[0].caption).toBe("Encaminhada da conversa com Maria Souza, 20/10 às 10:00:");
  });
  it("texto para Equipe leva o cabeçalho na frente", async () => {
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessage(textId, [eq1], uid);
    expect(texts[0].text).toContain("Encaminhada da conversa com Maria Souza, 20/10 às 10:05:\nQuero horário sexta");
  });
  it("para outra cliente vai só o conteúdo: sem nome, telefone nem legenda de origem", async () => {
    const outra = await dealOf("71988880002", "Joana Reis");
    await forwardMessage(photoId, [outra], uid);
    expect(medias[0].caption).toBeNull();
    await forwardMessage(textId, [outra], uid);
    expect(texts[0].text).toContain("Quero horário sexta");
    expect(texts[0].text).not.toMatch(/Maria|Encaminhada|5555/);
  });
  it("mais de 10 destinos é recusado; destino que falha não impede os outros", async () => {
    await expect(forwardMessage(textId, Array.from({ length: FORWARD_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`), uid)).rejects.toThrow(`Dá para encaminhar para até ${FORWARD_MAX} conversas de uma vez.`);
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    failFor.add("+5571988880003");
    const r = await forwardMessage(textId, [a, b], uid);
    expect(r.sent).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].dealId).toBe(a);
  });
  it("o limite vem de Configurações › Recursos", async () => {
    await saveFuncao("encaminhar", { params: { max_destinos: 1 } }, gestor, { confirmouEnvio: false });
    const a = await dealOf("71988880003", "A"), b = await dealOf("71988880004", "B");
    await expect(forwardMessage(textId, [a, b], uid)).rejects.toThrow("até 1 conversas");
  });
  it("função desligada recusa", async () => {
    await saveFuncao("encaminhar", { on: false }, gestor, { confirmouEnvio: false });
    const a = await dealOf("71988880003", "A");
    await expect(forwardMessage(textId, [a], uid)).rejects.toThrow("Encaminhar mensagem está desligada em Configurações › Recursos.");
    expect(texts).toEqual([]);
  });
  it("o cabeçalho é um texto editável", async () => {
    await saveFuncao("encaminhar", { textos: { cabecalho_equipe: "Veio de {nome} ({data})" } }, gestor, { confirmouEnvio: false });
    const eq1 = await dealOf("71988880001", "Sara Lima", "equipe");
    await forwardMessage(photoId, [eq1], uid);
    expect(medias[0].caption).toBe("Veio de Maria Souza (20/10 às 10:00)");
  });
  it("mídia já apagada pela retenção: 'Essa foto não está mais guardada no sistema.'", async () => {
    await db.update(messages).set({ mediaPurgedAt: new Date() }).where(eq(messages.id, photoId));
    const a = await dealOf("71988880003", "A");
    await expect(forwardMessage(photoId, [a], uid)).rejects.toThrow("Essa foto não está mais guardada no sistema.");
  });
  it("nota interna, ligação e mensagem apagada não podem ser encaminhadas", async () => {
    const a = await dealOf("71988880003", "A");
    const [d] = await db.select().from(deals).where(eq(deals.id, srcDeal));
    const [nota] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, direction: "out", kind: "nota", body: "interna", status: "sent" }).returning();
    const [lig] = await db.insert(messages).values({ dealId: srcDeal, contactId: d.contactId, direction: "in", kind: "call", body: null, status: "received" }).returning();
    await db.update(messages).set({ deletedAt: new Date() }).where(eq(messages.id, textId));
    for (const id of [nota.id, lig.id, textId]) await expect(forwardMessage(id, [a], uid)).rejects.toThrow("Essa mensagem não pode ser encaminhada.");
    expect(texts).toEqual([]);
  });
  it("destino repetido conta uma vez", async () => {
    const a = await dealOf("71988880003", "A");
    expect((await forwardMessage(textId, [a, a], uid)).sent).toBe(1);
  });
  it("destino que não existe falha sozinho", async () => {
    const r = await forwardMessage(textId, ["00000000-0000-4000-8000-000000000000"], uid);
    expect(r.sent).toBe(0);
    expect(r.failed[0].error).toBe("Conversa não encontrada.");
  });
});
