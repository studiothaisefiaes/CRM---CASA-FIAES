import { beforeEach, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { deals, stages } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, NOW, setupAgenda } from "../../../../test/agenda-fixtures";
import { agendaFunnelTx } from "./funnel-hook";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const stageOf = async (dealId: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].k;

it("horário marcado leva a conversa recente para Agendado e devolve o lead que mudou", async () => {
  const p = await cliente("Paula Souza", { conversaHaDias: 2, stage: "atendimento" });
  await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.ana.id, origin: "crm" });
  const moved = await db.transaction((tx) => agendaFunnelTx(tx, [p.contactId, p.contactId, null], NOW));
  expect(moved).toEqual([p.dealId]);
  expect(await stageOf(p.dealId!)).toBe("agendado");
});

it("decisão 4: sem conversa nos últimos 30 dias, a agenda não cria nem move cartão", async () => {
  const p = await cliente("Joana Lima", { conversaHaDias: 40 });
  await ap({ startsAt: bahia(16, 10), contactId: p.contactId, professionalId: s.ana.id, origin: "crm" });
  expect(await db.transaction((tx) => agendaFunnelTx(tx, [p.contactId], NOW))).toEqual([]);
  expect(await db.select().from(deals).where(eq(deals.contactId, p.contactId))).toHaveLength(0);
});
