import { beforeEach, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { deals, users } from "../db/schema";
import { resetDb } from "../../../test/db";

const { emit } = vi.hoisted(() => ({ emit: vi.fn(async (_type: string, _data?: Record<string, unknown>) => {}) }));
vi.mock("./events", async (orig) => ({ ...(await orig<typeof import("./events")>()), emit }));
import { recordInbound } from "./deals";
import { addNote } from "./notes";

beforeEach(async () => { await resetDb(); emit.mockClear(); });

it("anotar a ligação atualiza a Fila na hora (a prévia leva a anotação), não só a conversa", async () => {
  const [{ id: sara }] = await db.insert(users).values({ name: "Sara Lima", email: "sara@teste.local", role: "atendente", passwordHash: "x" }).returning();
  const c = await recordInbound({ channelId: null, externalId: "call:1", phoneRaw: "71999990003", kind: "call", body: "Ligação recebida · atendida", noWait: true });
  if (!("messageId" in c)) throw new Error("sem ligação");
  emit.mockClear();
  await addNote({ dealId: c.dealId, body: "marcou corte sábado", messageId: c.messageId }, sara);
  expect(emit).toHaveBeenCalledWith("mensagem_atualizada", { dealId: c.dealId });
  emit.mockClear();
  await addNote({ dealId: c.dealId, body: "nota comum" }, sara);
  expect(emit.mock.calls.map((x) => x[0])).not.toContain("mensagem_atualizada");
  expect((await db.select().from(deals).where(eq(deals.id, c.dealId))).length).toBe(1);
});
