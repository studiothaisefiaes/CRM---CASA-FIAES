import { beforeEach, expect, it, vi } from "vitest";
import { db } from "../db";
import { channels, deals, messages, webhookEvents } from "../db/schema";
import { ingestEvolution } from "./webhook";
import { resetDb } from "../../../test/db";
import { adClickInbound } from "../../../test/fixtures/evolution";

// Gravar a origem falhou (banco, dado estranho): a mensagem entra do mesmo jeito e o evento fica processado (nunca derruba a ingestão).
vi.mock("../domain/ad-origin", () => ({ captureOrigin: vi.fn(async () => { throw new Error("falha de teste"); }) }));

beforeEach(async () => {
  await resetDb();
  await db.insert(channels).values({ name: "Principal", instanceName: "casa-principal", status: "conectado" });
});

it("falha ao gravar o anúncio não derruba a mensagem", async () => {
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  const r = await ingestEvolution(adClickInbound());
  expect(r).toMatchObject({ ok: true, kind: "in" });
  expect(await db.select().from(messages)).toHaveLength(1);
  // A origem genérica de antes continua: "Anúncio".
  expect((await db.select().from(deals))[0]).toMatchObject({ sourceLabel: "Anúncio", adId: null });
  expect((await db.select().from(webhookEvents))[0].processedAt).not.toBeNull();
  expect(err.mock.calls.some((c) => String(c[0]).includes("origem do anúncio"))).toBe(true);
  err.mockRestore();
});
