import { beforeEach, expect, it, vi } from "vitest";
import { and, eq, isNull } from "drizzle-orm";

// Registra, no instante de cada evento de tempo real, se o aviso "escreveu" já existia (a tela que recebe o evento busca o sino na hora).
const seen: { type: string; aviso: unknown; alertsOpen: number }[] = [];
vi.mock("./events", async (orig) => {
  const real = await orig<typeof import("./events")>();
  return {
    ...real,
    emit: async (type: string, data: Record<string, unknown> = {}) => {
      const { db } = await import("../db");
      const { alerts } = await import("../db/schema");
      const open = data.dealId ? await db.select().from(alerts).where(and(eq(alerts.dealId, data.dealId as string), eq(alerts.type, "mensagem_cliente"), isNull(alerts.resolvedAt))) : [];
      seen.push({ type, aviso: data.aviso, alertsOpen: open.length });
    },
  };
});

const { db } = await import("../db");
const { channels } = await import("../db/schema");
const { resetDb } = await import("../../../test/db");
const { recordInbound, recordOutbound } = await import("./deals");

beforeEach(async () => { await resetDb(); seen.length = 0; });

it("o aviso nasce antes do evento da mensagem: quem recebe o evento já acha o aviso no sino", async () => {
  await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71900000401", pushName: "Cliente Ordem", body: "oi", at: new Date() });
  await recordInbound({ channelId: null, externalId: "O2", phoneRaw: "71900000401", body: "tudo bem?", at: new Date() });
  const msg = seen.filter((e) => e.type === "lead_criado" || e.type === "mensagem_recebida");
  expect(msg).toHaveLength(2);
  expect(msg.every((e) => e.alertsOpen === 1)).toBe(true);
});

it("o evento só pede som (aviso) quando a mensagem avisou: nada para mensagem com mais de 6 h; em modo quieto, só a de até 30 min", async () => {
  await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71900000402", body: "oi", at: new Date() });
  await recordInbound({ channelId: null, externalId: "S2", phoneRaw: "71900000402", body: "de ontem", at: new Date(Date.now() - 24 * 3_600_000) });
  const [ch] = await db.insert(channels).values({ name: "Teste", instanceName: "aviso-teste", status: "conectado", quietUntil: new Date(Date.now() + 3_600_000) }).returning();
  await recordInbound({ channelId: ch.id, externalId: "S3", phoneRaw: "71900000403", body: "atrasada da reconexão", at: new Date(Date.now() - 2 * 3_600_000) });
  // 23/10: o modo quieto calava também a cliente escrevendo AGORA (48 h sem "escreveu" depois do QR de 21/10).
  await recordInbound({ channelId: ch.id, externalId: "S4", phoneRaw: "71900000404", body: "escrevendo agora", at: new Date() });
  const avisos = seen.filter((e) => e.type === "lead_criado" || e.type === "mensagem_recebida").map((e) => e.aviso);
  expect(avisos).toEqual([true, undefined, undefined, true]);
});

it("mensagem que chega atrasada, mas a Casa já respondeu depois dela (pelo celular): não avisa nem toca (revisão 23/10)", async () => {
  const t = (minAgo: number) => new Date(Date.now() - minAgo * 60_000);
  const r = await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71900000405", body: "oi", at: t(20) });
  if (!("dealId" in r)) throw new Error("sem conversa");
  await recordOutbound({ dealId: r.dealId, channelId: null, body: "Oi! Já te respondo", at: t(5) });
  seen.length = 0;
  await recordInbound({ channelId: null, externalId: "R2", phoneRaw: "71900000405", body: "escrita antes da resposta", at: t(8) });
  const ev = seen.filter((e) => e.type === "mensagem_recebida");
  expect(ev.map((e) => [e.aviso, e.alertsOpen])).toEqual([[undefined, 0]]);
});
