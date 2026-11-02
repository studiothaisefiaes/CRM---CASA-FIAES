import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { channels, contacts, deals, outbox, settings, tasks, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "./deals";
import { archiveConversation } from "./conversation-archive";
import { saveFuncao } from "./funcoes";
import { sweepPosSilencio } from "./pos-silencio";
import { sweepRetomadaAutomatica } from "./retomada-automatica";
import { isOnlyLink } from "../../lib/so-link";

vi.mock("../ai/programada", () => ({ generateProgramada: async () => ({ status: "gerada", texto: "oi", costMicros: 1 }), programadaAvailable: async () => true }));

const OPEN: [string, string] = ["00:00", "23:59"];
const HOURS = { 0: OPEN, 1: OPEN, 2: OPEN, 3: OPEN, 4: OPEN, 5: OPEN, 6: OPEN };
const T0 = new Date(Date.now() - 2 * 86_400_000);
const plusH = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
let sara = "", channelId = "";
const novo = async (body: string, ext = "IN1", phone = "71999990021") => {
  const r = await recordInbound({ channelId, externalId: ext, phoneRaw: phone, pushName: "Paula", body, at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem lead");
  return r.dealId;
};
const auto = (dealId: string) => recordOutbound({ dealId, externalId: `A${dealId}`, body: "Bem-vinda", at: plusH(T0, 0.01), automated: true } as never);
const deal = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];
const tarefa = async (dealId: string, dueAt: Date, title = "Remarcar") => {
  const d = await deal(dealId);
  const [t] = await db.insert(tasks).values({ dealId, contactId: d.contactId, kind: "proxima_acao", title, dueAt, assigneeId: sara }).returning();
  return t;
};

beforeEach(async () => {
  await resetDb();
  await db.insert(settings).values({ key: "business_hours", value: HOURS });
  [{ id: sara }] = await db.insert(users).values({ name: "Sara", email: "sara@teste.local", role: "atendente", passwordHash: "x", signature: "SARA" }).returning();
  [{ id: channelId }] = await db.insert(channels).values({ name: "Recepção", instanceName: "rec-teste", status: "conectado", phone: "+557133330000" }).returning();
});
afterEach(() => vi.useRealTimers());

describe("Resolver e retomada", () => {
  it("encerra a vencida e mantém a futura", async () => {
    const id = await novo("Oi, quero remarcar");
    const v = await tarefa(id, new Date(Date.now() - 3_600_000));
    const f = await tarefa(id, new Date(Date.now() + 86_400_000));
    await archiveConversation(id, sara);
    const get = async (x: string) => (await db.select().from(tasks).where(eq(tasks.id, x)))[0].doneAt;
    expect(await get(v.id)).not.toBeNull();
    expect(await get(f.id)).toBeNull();
  });
});

describe("Só link", () => {
  it("reconhece só link", () => {
    expect(isOnlyLink("https://youtube.com/shorts/x?is=1")).toBe(true);
    expect(isOnlyLink(" olha https://a.com")).toBe(false);
    expect(isOnlyLink("quero orçamento")).toBe(false);
  });
  it("só link e automática: sai da espera", async () => {
    const id = await novo("https://youtube.com/shorts/x");
    expect((await deal(id)).awaitingReplySince).not.toBeNull();
    await auto(id);
    expect((await deal(id)).awaitingReplySince).toBeNull();
  });
  it("texto de verdade e automática: continua cobrando", async () => {
    const id = await novo("Quero um orçamento");
    await auto(id);
    expect((await deal(id)).awaitingReplySince).not.toBeNull();
  });
});

describe("Mensagem depois do silêncio", () => {
  it("desligada não envia; ligada envia uma vez só e só para quem mandou link", async () => {
    const link = await novo("https://youtube.com/shorts/x");
    await auto(link);
    const real = await novo("Quero um orçamento", "IN2", "71999990022");
    await auto(real);
    const now = plusH(T0, 5);
    expect(await sweepPosSilencio(now)).toBe(0);
    await saveFuncao("pos_silencio", { on: true }, sara, { confirmouEnvio: true });
    expect(await sweepPosSilencio(now)).toBe(1);
    expect(await sweepPosSilencio(now)).toBe(0);
    const o = await db.select().from(outbox);
    expect(o).toHaveLength(1);
    expect(o[0].dealId).toBe(link);
  });
});

describe("Retomada automática", () => {
  const ligar = async () => {
    await saveFuncao("retomada_ia", { on: true }, sara, { confirmouEnvio: true });
    await saveFuncao("retomada_automatica", { on: true, params: { max_dia: 1 } }, sara, { confirmouEnvio: true });
  };
  const pronta = async (ext: string, phone: string) => {
    const id = await novo("Vou ver e te falo", ext, phone);
    await db.update(deals).set({ awaitingReplySince: null, ownerId: sara }).where(eq(deals.id, id));
    return id;
  };
  it("desligada não programa nada", async () => {
    const id = await pronta("IN1", "71999990021");
    await tarefa(id, new Date(Date.now() - 3_600_000));
    expect(await sweepRetomadaAutomatica()).toBe(0);
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
  it("programa pela IA, respeita o limite do dia e deixa de fora quem recusou WhatsApp", async () => {
    await ligar();
    const a = await pronta("IN1", "71999990021");
    const t = await tarefa(a, new Date(Date.now() - 3_600_000));
    const b = await pronta("IN2", "71999990022");
    await tarefa(b, new Date(Date.now() - 7_200_000));
    const c = await pronta("IN3", "71999990023");
    await tarefa(c, new Date(Date.now() - 1_800_000));
    await db.update(contacts).set({ consentWhatsapp: false }).where(eq(contacts.id, (await deal(c)).contactId));
    expect(await sweepRetomadaAutomatica()).toBe(1);
    expect(await sweepRetomadaAutomatica()).toBe(0);
    const [o] = await db.select().from(outbox);
    expect(o.dealId).toBe(a);
    expect(o.options).toMatchObject({ source: "agendada", ia: "Remarcar", taskId: t.id, retomadaAuto: true });
  });
  it("visita marcada fica de fora", async () => {
    await ligar();
    const a = await pronta("IN1", "71999990021");
    await db.update(deals).set({ scheduledAt: new Date(Date.now() + 86_400_000) }).where(eq(deals.id, a));
    await tarefa(a, new Date(Date.now() - 3_600_000));
    expect(await sweepRetomadaAutomatica()).toBe(0);
  });
});
