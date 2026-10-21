import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { createQuickReply } from "../domain/quick-replies";
import { getDealDetail } from "./deal";

let dealId = "", sara = "", bia = "";
beforeEach(async () => {
  await resetDb();
  [{ id: sara }, { id: bia }] = await db.insert(users).values([
    { name: "Sara Lima", email: "sara-dr@teste.local", role: "atendente", passwordHash: "x" },
    { name: "Bia Souza", email: "bia-dr@teste.local", role: "atendente", passwordHash: "x" },
  ]).returning();
  const r = await recordInbound({ channelId: null, externalId: "DR1", phoneRaw: "71999990077", pushName: "Clara Teste", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  await createQuickReply({ label: "da-sara-teste", body: "oi", scope: "minha" }, { id: sara, canShare: false });
});

describe("conversa: respostas prontas de quem vê e {meu_nome}", () => {
  it("a atendente vê as universais e as dela (com selo); a colega não vê a dela", async () => {
    const mine = (await getDealDetail(dealId, { viewer: { id: sara, name: "Sara Lima", canShare: false } }))!;
    expect(mine.quickReplies.find((q) => q.label === "da-sara-teste")?.mine).toBe(true);
    expect(mine.replyVars.meuNome).toBe("Sara");
    expect(mine.canShareReplies).toBe(false);
    const other = (await getDealDetail(dealId, { viewer: { id: bia, name: "Bia Souza", canShare: true } }))!;
    expect(other.quickReplies.some((q) => q.label === "da-sara-teste")).toBe(false);
    expect(other.canShareReplies).toBe(true);
  });
});
