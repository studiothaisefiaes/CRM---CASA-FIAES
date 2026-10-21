import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import { users } from "../db/schema";
import { consumePrintToken, issuePrintToken } from "./print-token";
import { resetDb } from "../../../test/db";

describe("token da página de impressão do PDF", () => {
  let ana: string;
  beforeEach(async () => {
    await resetDb();
    [{ id: ana }] = await db.insert(users).values({ name: "Ana", email: "a@c.com", role: "atendente", passwordHash: "x" }).returning();
  });

  it("vale uma vez só, para quem pediu", async () => {
    const t = await issuePrintToken(ana);
    expect((await consumePrintToken(t))?.id).toBe(ana);
    expect(await consumePrintToken(t)).toBeNull();
  });

  it("vencido (5 min) ou inventado não abre", async () => {
    const t = await issuePrintToken(ana, new Date(Date.now() - 6 * 60_000));
    expect(await consumePrintToken(t)).toBeNull();
    expect(await consumePrintToken("qualquer-coisa")).toBeNull();
    expect(await consumePrintToken(undefined)).toBeNull();
  });

  it("pessoa desativada depois de pedir não abre", async () => {
    const t = await issuePrintToken(ana);
    const { eq } = await import("drizzle-orm");
    await db.update(users).set({ active: false }).where(eq(users.id, ana));
    expect(await consumePrintToken(t)).toBeNull();
  });
});
