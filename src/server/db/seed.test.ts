import { describe, it, expect, beforeAll } from "vitest";
import { eq, ne } from "drizzle-orm";
import { db } from "./index";
import { seed } from "./seed";
import { resetDb } from "../../../test/db";
import { stages, automations, lists } from "./schema";
import { DEFAULT_AUTOMATIONS } from "./seed-data";

describe("seed", () => {
  beforeAll(resetDb);
  it("é idempotente", async () => {
    await seed(db); await seed(db);
    expect((await db.select().from(stages)).length).toBe(9);
    expect((await db.select().from(automations)).length).toBe(10);
    expect((await db.select().from(lists).where(ne(lists.kind, "service"))).length).toBe(22);
  });
  it("toda automação que envia mensagem nasce desligada", async () => {
    await seed(db);
    const rows = await db.select().from(automations);
    const sends = rows.filter((a) => (a.actions as { type: string }[]).some((x) => x.type.startsWith("enviar_")));
    expect(sends.map((a) => a.key).sort()).toEqual(["confirmacao_d1", "lembrete_agendamento"]);
    expect(sends.every((a) => a.enabled === false)).toBe(true);
    expect(DEFAULT_AUTOMATIONS.filter((a) => a.actions.some((x) => x.type.startsWith("enviar_"))).every((a) => a.enabled === false)).toBe(true);
  });
  it("não cria serviços: os nomes vêm da Casa (cadastrados em Configurações › Listas › Serviços)", async () => {
    await db.delete(lists).where(eq(lists.kind, "service")); // resetDb põe os serviços de teste
    await seed(db);
    expect(await db.select().from(lists).where(eq(lists.kind, "service"))).toHaveLength(0);
  });
});
