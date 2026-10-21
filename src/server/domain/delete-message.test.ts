import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { auditLog, channels, messages, users } from "../db/schema";
import { recordInbound } from "./deals";
import { sendFromCrm } from "./send";
import { setWhatsappProvider } from "../whatsapp/evolution";
import { ProviderError } from "../whatsapp/provider";
import { resetDb } from "../../../test/db";
import { deleteForEveryone } from "./delete-message";

/** Provider falso: nenhum teste fala com a Evolution de verdade. */
const deleted: { instance: string; to: string; id: string }[] = [];
let refuse: Error | null = null;
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async () => ({ externalId: `OUT${Math.random()}` }),
  deleteForEveryone: async (instance: string, to: string, id: string) => { if (refuse) throw refuse; deleted.push({ instance, to, id }); },
};
let uid = "", dealId = "", chId = "";
const NOW = new Date("2026-10-17T15:00:00Z");

beforeEach(async () => {
  deleted.length = 0; refuse = null; await resetDb(); setWhatsappProvider(fake);
  [{ id: uid }] = await db.insert(users).values({ name: "Cati Souza", email: "cati@c.com", role: "atendente", passwordHash: "x" }).returning();
  [{ id: chId }] = await db.insert(channels).values({ name: "Rec", instanceName: "rec", status: "conectado", phone: "+557199990404" }).returning();
  const r = await recordInbound({ channelId: chId, externalId: "IN1", phoneRaw: "71999995555", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
});
afterEach(() => setWhatsappProvider(null));

const out = async (o: Partial<typeof messages.$inferInsert> = {}) => {
  const [c] = await db.select({ contactId: messages.contactId }).from(messages).limit(1);
  return (await db.insert(messages).values({ dealId, contactId: c.contactId, channelId: chId, direction: "out", body: "Oi! Tudo bem?", status: "sent",
    externalId: `X${Math.random()}`, createdAt: new Date(NOW.getTime() - 3_600_000), ...o }).returning())[0];
};

describe("apagar para todos pelo CRM (17/10: a cliente recebeu duas mensagens)", () => {
  it("mensagem enviada pelo CRM: chama a Evolution com o id e o número, marca apagada e registra quem apagou", async () => {
    await sendFromCrm(dealId, "Mensagem repetida", uid);
    const [m] = await db.select().from(messages).where(and(eq(messages.dealId, dealId), eq(messages.direction, "out")));
    await deleteForEveryone(m.id, uid, new Date(m.createdAt.getTime() + 60_000));
    expect(deleted).toEqual([{ instance: "rec", to: "+5571999995555", id: m.externalId }]);
    expect((await db.select().from(messages).where(eq(messages.id, m.id)))[0].deletedAt).not.toBeNull();
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.entity, "message"), eq(auditLog.entityId, m.id)));
    expect(log).toMatchObject({ userId: uid, action: "apagou_para_todos" });
  });

  it("enviada pelo celular ou pelo ChatGuru (aparece como enviada) também pode", async () => {
    const m = await out({ fromPhone: true, sentVia: "celular" });
    await deleteForEveryone(m.id, uid, NOW);
    expect(deleted.map((d) => d.id)).toEqual([m.externalId]);
  });

  it("recusa: mensagem da cliente, já apagada, sem id do WhatsApp, nota interna e importada", async () => {
    const [inbound] = await db.select().from(messages).where(eq(messages.direction, "in"));
    await expect(deleteForEveryone(inbound.id, uid, NOW)).rejects.toThrow("Só dá para apagar mensagens enviadas pela Casa.");
    await expect(deleteForEveryone((await out({ deletedAt: NOW })).id, uid, NOW)).rejects.toThrow("Essa mensagem já foi apagada.");
    await expect(deleteForEveryone((await out({ externalId: null })).id, uid, NOW)).rejects.toThrow("Essa mensagem não chegou ao WhatsApp");
    await expect(deleteForEveryone((await out({ kind: "nota" })).id, uid, NOW)).rejects.toThrow("Só dá para apagar mensagens enviadas pela Casa.");
    await expect(deleteForEveryone((await out({ importedAt: NOW })).id, uid, NOW)).rejects.toThrow("importada");
    expect(deleted).toHaveLength(0);
  });

  it("limite de tempo do WhatsApp: antiga demais nem tenta; se o WhatsApp recusar, diz em texto claro e não marca apagada", async () => {
    const velha = await out({ createdAt: new Date(NOW.getTime() - 3 * 86_400_000) });
    await expect(deleteForEveryone(velha.id, uid, NOW)).rejects.toThrow("Não deu para apagar para todos: o WhatsApp só deixa apagar mensagens recentes (até uns 2 dias).");
    expect(deleted).toHaveLength(0);
    refuse = new ProviderError("Evolution respondeu 400: \"message not found\"", 400);
    const m = await out();
    await expect(deleteForEveryone(m.id, uid, NOW)).rejects.toThrow(/^Não deu para apagar para todos: o WhatsApp recusou/);
    expect((await db.select().from(messages).where(eq(messages.id, m.id)))[0].deletedAt).toBeNull();
  });
});
