import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, channels, deals, outbox, settings, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "./deals";
import { drainOutbox } from "./outbox";
import { resume } from "./retomada";
import { saveFuncao } from "./funcoes";
import { setWhatsappProvider } from "../whatsapp/evolution";

// Retomada pela IA (29/10, pedido da Thaise): a IA escreve na hora de sair. A chamada da IA é falsa (nunca a Anthropic).
const gerar = vi.fn();
vi.mock("../ai/programada", () => ({ generateProgramada: (...a: unknown[]) => gerar(...a), programadaAvailable: async () => true }));

const OPEN: [string, string] = ["09:00", "18:00"];
const HOURS = { 0: null, 1: null, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date("2026-10-13T13:00:00Z"); // terça 10:00 em Salvador
const AT = new Date("2026-10-14T13:00:00Z"); // quarta 10:00
const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
const sent: string[] = [];
const fake = {
  createInstance: async () => {}, connect: async () => ({ status: "conectado" as const }), state: async () => "conectado" as const, logout: async () => {}, remove: async () => {},
  sendText: async (_i: string, _to: string, text: string) => { sent.push(text); return { externalId: `OUT${sent.length}` }; },
};
let sara = "", dealId = "", channelId = "";

beforeEach(async () => {
  sent.length = 0; gerar.mockReset();
  gerar.mockResolvedValue({ status: "gerada", texto: "Oi, Paula! Conseguiu ver a agenda para remarcar?", costMicros: 1 });
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x", signature: "SARA" }).returning();
  [{ id: channelId }] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
  const r = await recordInbound({ channelId, externalId: "IN1", phoneRaw: "71999990021", pushName: "Paula Teste", body: "Vou ver e te falo", at: plus(T0, -5), now: plus(T0, -5) });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  setWhatsappProvider(fake);
});
afterEach(() => setWhatsappProvider(null));

const ligar = (max = 40) => saveFuncao("retomada_ia", { on: true, params: { max_dia: max } }, sara, { confirmouEnvio: true });
const task = async () => (await db.select().from(tasks).where(eq(tasks.dealId, dealId)))[0];

describe("Retomada pela IA", () => {
  it("desligada: Retomar sem texto continua só lembrete (nada na fila de envio)", async () => {
    await resume(dealId, { dueAt: AT, motivo: "Ver se ela decidiu" }, sara, T0);
    expect(await db.select().from(outbox)).toHaveLength(0);
    expect((await task()).doneAt).toBeNull();
  });

  it("ligada: na hora a IA escreve com o pedido da atendente e a mensagem sai assinada; a retomada conta como feita", async () => {
    await ligar();
    await resume(dealId, { dueAt: AT, motivo: "Ver se ela decidiu", ia: "perguntar se ela conseguiu ver a agenda" }, sara, T0);
    const [o] = await db.select().from(outbox);
    expect(o.text).toBe("✨ A IA escreve na hora: perguntar se ela conseguiu ver a agenda");
    expect(o.options).toMatchObject({ source: "agendada", ia: "perguntar se ela conseguiu ver a agenda" });
    expect((await drainOutbox(plus(AT, -1))).sent).toBe(0);
    expect(gerar).not.toHaveBeenCalled();
    expect((await drainOutbox(AT)).sent).toBe(1);
    expect(gerar).toHaveBeenCalledWith(expect.objectContaining({ dealIds: [dealId], tema: "perguntar se ela conseguiu ver a agenda", userId: sara }));
    expect(sent[0]).toContain("Conseguiu ver a agenda");
    expect(sent[0].startsWith("*SARA - CASA FIAES:*")).toBe(true);
    expect((await db.select().from(outbox))[0]).toMatchObject({ status: "sent", text: "Oi, Paula! Conseguiu ver a agenda para remarcar?" });
    expect((await task()).doneAt).not.toBeNull();
  });

  it("sem pedido, vale o motivo (a retomada que o sistema propôs também vira mensagem)", async () => {
    await ligar();
    await resume(dealId, { dueAt: AT, motivo: "Retomar: cancelou sem remarcar" }, sara, T0);
    await drainOutbox(AT);
    expect(gerar).toHaveBeenCalledWith(expect.objectContaining({ tema: "Retomar: cancelou sem remarcar" }));
  });

  it("a cliente escreveu antes: não chama a IA, não sai e a retomada é cancelada", async () => {
    await ligar();
    await resume(dealId, { dueAt: AT, ia: "perguntar se decidiu" }, sara, T0);
    await recordInbound({ channelId, externalId: "IN2", phoneRaw: "71999990021", pushName: "Paula Teste", body: "Decidi sim!", at: plus(T0, 60), now: plus(T0, 60) });
    await drainOutbox(AT);
    expect(gerar).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("a IA não conseguiu escrever, ou desligaram antes da hora: não sai, avisa quem marcou e o lembrete fica aberto", async () => {
    await ligar();
    gerar.mockResolvedValueOnce({ status: "falhou", erro: "timeout" });
    await resume(dealId, { dueAt: AT, ia: "perguntar se decidiu" }, sara, T0);
    await drainOutbox(AT);
    expect(sent).toHaveLength(0);
    expect((await db.select().from(outbox))[0].status).toBe("failed");
    expect((await db.select().from(alerts)).some((a) => a.type === "agendada_falhou" && a.userId === sara)).toBe(true);
    expect((await task()).doneAt).toBeNull();
  });

  it("limite do dia: passou do máximo, não sai", async () => {
    await ligar(1);
    await db.insert(outbox).values({ dealId, kind: "text", text: "antiga", status: "sent", sentAt: plus(AT, -60), notBefore: plus(AT, -60), createdBy: sara,
      options: { source: "agendada", ia: "x" } });
    await resume(dealId, { dueAt: AT, ia: "perguntar se decidiu" }, sara, T0);
    await drainOutbox(AT);
    expect(gerar).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });

  it("com texto escrito (ou aprovado depois de Gerar), sai o texto e a IA não é chamada", async () => {
    await ligar();
    await resume(dealId, { dueAt: AT, texto: "Oi! Conseguiu ver?", ia: "ignorado" }, sara, T0);
    await drainOutbox(AT);
    expect(gerar).not.toHaveBeenCalled();
    expect(sent[0]).toContain("Oi! Conseguiu ver?");
    expect((await db.select().from(deals).where(eq(deals.id, dealId)))[0].awaitingReplySince).toBeNull();
  });
});
