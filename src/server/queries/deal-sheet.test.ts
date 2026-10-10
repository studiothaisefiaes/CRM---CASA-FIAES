import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { getDealDetail, getDealSheetData } from "./deal";

beforeEach(async () => { await resetDb(); });

describe("getDealSheetData: o que as folhas de agendar, fechar venda e perdido precisam, sem a conversa", () => {
  it("traz o lead, as etapas, os serviços, os motivos de perda e a equipe; nada de mensagens nem histórico", async () => {
    const r = await recordInbound({ channelId: null, externalId: "SH1", phoneRaw: "71999770001", body: "oi" });
    if (!("dealId" in r)) throw new Error();
    const d = (await getDealSheetData(r.dealId))!;
    const full = (await getDealDetail(r.dealId))!;
    expect(d.deal.id).toBe(r.dealId);
    expect(d.stage.kind).toBe("lead");
    expect(d.stages.map((s) => s.key)).toEqual(full.stages.map((s) => s.key));
    expect(d.services.map((s) => s.id)).toEqual(full.services.map((s) => s.id));
    expect(d.lostReasons.map((s) => s.id)).toEqual(full.lostReasons.map((s) => s.id));
    expect(d.services.length).toBeGreaterThan(0);
    expect(d.lostReasons.length).toBeGreaterThan(0);
    expect(d.nextAction).toBeNull();
    expect(Object.keys(d)).not.toContain("messages");
    expect(Object.keys(d)).not.toContain("events");
  });
  it("lead que não existe devolve null", async () => {
    expect(await getDealSheetData("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});
