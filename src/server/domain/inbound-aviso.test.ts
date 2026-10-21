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
const { recordInbound } = await import("./deals");

beforeEach(async () => { await resetDb(); seen.length = 0; });

it("o aviso nasce antes do evento da mensagem: quem recebe o evento já acha o aviso no sino", async () => {
  await recordInbound({ channelId: null, externalId: "O1", phoneRaw: "71900000401", pushName: "Cliente Ordem", body: "oi", at: new Date() });
  await recordInbound({ channelId: null, externalId: "O2", phoneRaw: "71900000401", body: "tudo bem?", at: new Date() });
  const msg = seen.filter((e) => e.type === "lead_criado" || e.type === "mensagem_recebida");
  expect(msg).toHaveLength(2);
  expect(msg.every((e) => e.alertsOpen === 1)).toBe(true);
});

it("o evento só pede som (aviso) quando a mensagem avisou: nada para mensagem com mais de 6 h nem com o canal em modo quieto", async () => {
  await recordInbound({ channelId: null, externalId: "S1", phoneRaw: "71900000402", body: "oi", at: new Date() });
  await recordInbound({ channelId: null, externalId: "S2", phoneRaw: "71900000402", body: "de ontem", at: new Date(Date.now() - 24 * 3_600_000) });
  const [ch] = await db.insert(channels).values({ name: "Teste", instanceName: "aviso-teste", status: "conectado", quietUntil: new Date(Date.now() + 3_600_000) }).returning();
  await recordInbound({ channelId: ch.id, externalId: "S3", phoneRaw: "71900000403", body: "histórico importando", at: new Date() });
  const avisos = seen.filter((e) => e.type === "lead_criado" || e.type === "mensagem_recebida").map((e) => e.aviso);
  expect(avisos).toEqual([true, undefined, undefined]);
});
