import { describe, it, expect, beforeAll } from "vitest";
import { db } from "./index";
import { seed } from "./seed";
import { resetDb } from "../../../test/db";
import { stages, automations, lists } from "./schema";

describe("seed", () => {
  beforeAll(resetDb);
  it("é idempotente", async () => {
    await seed(db); await seed(db);
    expect((await db.select().from(stages)).length).toBe(9);
    expect((await db.select().from(automations)).length).toBe(7);
    expect((await db.select().from(lists)).length).toBe(22);
  });
});
