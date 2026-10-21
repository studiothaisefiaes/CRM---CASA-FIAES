import { beforeEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../db";
import { resetDb } from "../../../../test/db";
import { cliente, NOW, setupAgenda } from "../../../../test/agenda-fixtures";

vi.mock("../avec/funnel-sync", async (orig) => ({ ...(await orig<typeof import("../avec/funnel-sync")>()), syncContactFunnelTx: vi.fn(async () => { throw new Error("falha no funil"); }) }));
import { agendaFunnelTx } from "./funnel-hook";

beforeEach(async () => { await resetDb(); await setupAgenda(); });

it("um erro no funil vai para o log e não derruba a transação da agenda", async () => {
  const p = await cliente("Paula Souza", { conversaHaDias: 1 });
  const o = console.error; const errs: unknown[] = []; console.error = (...a: unknown[]) => { errs.push(a); };
  try {
    const r = await db.transaction(async (tx) => {
      const moved = await agendaFunnelTx(tx, [p.contactId], NOW);
      return { moved, ainda: (await tx.execute(sql`select 1 as ok`)).rows.length }; // a transação continua usável depois do savepoint desfeito
    });
    expect(r).toEqual({ moved: [], ainda: 1 });
  } finally { console.error = o; }
  expect(errs).toHaveLength(1);
});
