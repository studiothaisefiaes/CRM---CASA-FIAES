import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db";
import { users } from "../db/schema";
import { recordInbound, recordOutbound, moveDeal } from "../domain/deals";
import { updateDeal } from "../domain/updates";
import { funnel, responseTimes, origins, finance, summary, toCsv, periodStart } from "./index";
import { resetDb } from "../../../test/db";

describe("relatórios", () => {
  let ana: string;
  beforeEach(async () => {
    await resetDb();
    [{ id: ana }] = await db.insert(users).values({ name: "Ana", email: "ana@c.com", role: "atendente", passwordHash: "x" }).returning();
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      const r = await recordInbound({ channelId: null, externalId: `m${i}`, phoneRaw: `7199900001${i}`, body: i === 0 ? "vim pelo instagram" : "oi", at: new Date(now - 300_000) });
      if (!("dealId" in r)) throw new Error();
      await recordOutbound({ dealId: r.dealId, channelId: null, body: "oi", userId: ana, at: new Date(now - 300_000 + (i + 1) * 60_000) });
      if (i === 0) { await updateDeal(r.dealId, { valueCents: 115800, paymentMethod: "pix" }, ana); await moveDeal(r.dealId, "fechado", ana); }
    }
  });

  it("funil conta quem passou por cada etapa", async () => {
    const f = await funnel({ period: "mes" });
    expect(f.find((s) => s.key === "lead")!.reached).toBe(3);
    expect(f.find((s) => s.key === "atendimento")!.reached).toBe(3);
    expect(f.find((s) => s.key === "fechado")!.reached).toBe(1);
  });

  it("tempo de resposta por pessoa contra a meta de 2 min", async () => {
    const [r] = await responseTimes({ period: "mes" });
    expect(r.name).toBe("Ana");
    expect(r.responses).toBe(3);
    expect(r.avgSeconds).toBe(120);
    expect(r.withinGoal).toBe(2);
  });

  it("origem, financeiro e resumo", async () => {
    expect((await origins({ period: "mes" })).find((o) => o.origin === "Instagram")).toMatchObject({ leads: 1, won: 1, revenueCents: 115800 });
    const fin = await finance({ period: "mes" });
    expect(fin).toMatchObject({ totalCents: 115800, deals: 1, ticketCents: 115800 });
    expect(fin.byMethod[0].method).toBe("pix");
    expect(await summary({ period: "mes" })).toMatchObject({ leads: 3, won: 1, open: 2 });
    expect((await funnel({ period: "mes", ownerId: ana })).find((s) => s.key === "lead")!.reached).toBe(3);
  });

  it("CSV com BOM, ; e aspas", () => {
    expect(toCsv(["a", "b"], [["x;y", 2]])).toBe('﻿a;b\r\n"x;y";2');
  });

  it("início do período no fuso de Salvador", () => {
    expect(periodStart("hoje", new Date("2026-10-09T02:00:00Z")).toISOString()).toBe("2026-10-08T03:00:00.000Z");
    expect(periodStart("mes", new Date("2026-10-09T12:00:00Z")).toISOString()).toBe("2026-10-01T03:00:00.000Z");
  });
});
