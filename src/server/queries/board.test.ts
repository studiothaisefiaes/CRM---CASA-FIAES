import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { alerts, deals, stages } from "../db/schema";
import { recordInbound } from "../domain/deals";
import { resetDb } from "../../../test/db";
import { getBoard } from "./board";

const ids = (b: Awaited<ReturnType<typeof getBoard>>) => b.flatMap((s) => s.cards.map((c) => c.id));

describe("getBoard: filtros de drill-down dos relatórios", () => {
  let late: string, calm: string;
  beforeEach(async () => {
    await resetDb();
    const mk = async (n: number) => { const r = await recordInbound({ channelId: null, externalId: `B${n}`, phoneRaw: `7199977000${n}`, body: "oi" }); if (!("dealId" in r)) throw new Error(); return r.dealId; };
    late = await mk(1); calm = await mk(2);
    await db.insert(alerts).values({ dealId: late, type: "sem_resposta_minutos", message: "x", dedupeKey: "k1", waitKey: `${late}:espera` });
  });

  it("atrasados: só quem tem alerta de espera aberto", async () => {
    expect(ids(await getBoard({ filtro: "atrasados" }))).toEqual([late]);
    await db.update(alerts).set({ resolvedAt: new Date() }).where(eq(alerts.dealId, late));
    expect(ids(await getBoard({ filtro: "atrasados" }))).toEqual([]);
  });

  it("esperando: quem aguarda resposta; sem filtro mostra todos", async () => {
    expect((ids(await getBoard({ filtro: "esperando" }))).sort()).toEqual([late, calm].sort());
    await db.update(deals).set({ awaitingReplySince: null }).where(eq(deals.id, calm));
    expect(ids(await getBoard({ filtro: "esperando" }))).toEqual([late]);
    expect(ids(await getBoard({}))).toHaveLength(2);
  });

  it("parados: além do limite de dias da etapa, e por etapa", async () => {
    await db.update(stages).set({ staleDays: 2 }).where(eq(stages.key, "lead"));
    await db.update(deals).set({ stageEnteredAt: new Date(Date.now() - 5 * 86_400_000) }).where(eq(deals.id, calm));
    expect(ids(await getBoard({ filtro: "parados" }))).toEqual([calm]);
    expect(ids(await getBoard({ filtro: "parados", etapa: "lead" }))).toEqual([calm]);
    expect(ids(await getBoard({ filtro: "parados", etapa: "atendimento" }))).toEqual([]);
  });

  it("origem real: 'Não identificada' filtra os leads sem origem", async () => {
    await db.update(deals).set({ origin: "Instagram", sourceLabel: "Instagram" }).where(eq(deals.id, late));
    await db.update(deals).set({ origin: "WhatsApp", sourceLabel: null }).where(eq(deals.id, calm));
    expect(ids(await getBoard({ filtro: "esperando", source: "Instagram" }))).toEqual([late]);
    expect(ids(await getBoard({ filtro: "esperando", source: "Não identificada" }))).toEqual([calm]);
  });
});
