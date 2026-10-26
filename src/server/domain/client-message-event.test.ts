import { beforeEach, expect, it, vi } from "vitest";
import { resetDb } from "../../../test/db";

const emitted = vi.hoisted(() => [] as { type: string; data: Record<string, unknown> }[]);
vi.mock("./events", async (orig) => ({ ...(await orig<typeof import("./events")>()), emit: async (type: string, data: Record<string, unknown> = {}) => { emitted.push({ type, data }); } }));

const { recordInbound } = await import("./deals");

beforeEach(async () => { await resetDb(); emitted.length = 0; });

it("o evento da mensagem leva o texto do aviso: a tela de cada pessoa da equipe mostra a notificação (Cati 24/10)", async () => {
  await recordInbound({ channelId: null, externalId: "E1", phoneRaw: "71900000201", pushName: "Carla Werneck", body: "Posso chegar 15 min mais tarde?", at: new Date() });
  await recordInbound({ channelId: null, externalId: "E2", phoneRaw: "71900000201", body: "Obrigada!", at: new Date() });
  const msgs = emitted.filter((e) => e.type === "lead_criado" || e.type === "mensagem_recebida");
  expect(msgs.map((e) => e.data.texto)).toEqual(["Carla Werneck escreveu: “Posso chegar 15 min mais tarde?”", "Carla Werneck escreveu: “Obrigada!”"]);
  expect(msgs.every((e) => e.data.aviso === true)).toBe(true);
});

it("mensagem velha (reprocessada) não leva aviso nem texto", async () => {
  await recordInbound({ channelId: null, externalId: "E3", phoneRaw: "71900000202", pushName: "Rita", body: "oi", at: new Date(Date.now() - 8 * 3_600_000) });
  const [e] = emitted.filter((x) => x.type === "lead_criado");
  expect(e.data.aviso).toBeUndefined();
  expect(e.data.texto).toBeUndefined();
});
