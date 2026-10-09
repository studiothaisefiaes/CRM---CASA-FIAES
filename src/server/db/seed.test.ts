import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "./index";
import { seed } from "./seed";
import { resetDb } from "../../../test/db";
import { stages, automations, lists } from "./schema";

describe("seed", () => {
  beforeAll(resetDb);
  it("é idempotente", async () => {
    await seed(db); await seed(db);
    expect((await db.select().from(stages)).length).toBe(9);
    expect((await db.select().from(automations)).length).toBe(9);
    expect((await db.select().from(lists)).length).toBe(27);
  });
  it("serviços recorrentes têm ciclo de retorno", async () => {
    await seed(db);
    const rows = await db.select().from(lists).where(eq(lists.kind, "service"));
    const ciclo = Object.fromEntries(rows.map((r) => [r.label, r.cycleDays]));
    expect(ciclo).toEqual({ "Avaliação capilar": null, "Tratamento de queda": null, "Coloração": 35, "Corte": null, "Hidratação": 30 });
  });
});
