import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, deals, lists, professionals } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound } from "../domain/deals";
import { replyVarsOf, slotLabel } from "./reply-vars";

const NOW = new Date("2026-10-20T13:00:00Z"); // terça 10:00
let dealId = "", contactId = "", pro = "";
beforeEach(async () => {
  await resetDb();
  const r = await recordInbound({ channelId: null, externalId: "V1", phoneRaw: "71999990031", pushName: "Carla Salgado Teste", body: "oi" });
  if (!("dealId" in r)) throw new Error("sem lead");
  dealId = r.dealId;
  contactId = (await db.select().from(deals).where(eq(deals.id, dealId)))[0].contactId;
  [{ id: pro }] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
});

describe("variáveis da conversa", () => {
  it("rótulo do horário em Salvador, no formato das mensagens da Casa (21/10)", () => {
    expect(slotLabel(new Date("2026-10-22T18:00:00Z"))).toBe("quinta-feira, 22/10 às 15h");
    expect(slotLabel(new Date("2026-10-23T02:30:00Z"))).toBe("quinta-feira, 22/10 às 23h30"); // já é dia 23 em UTC
  });
  it("horário marcado no lead, com a profissional escolhida (nome com só a inicial maiúscula)", async () => {
    const [svc] = await db.insert(lists).values({ kind: "service", label: "Mega hair teste" }).returning();
    await db.update(deals).set({ scheduledAt: new Date("2026-10-22T18:00:00Z"), professionalId: pro, serviceId: svc.id }).where(eq(deals.id, dealId));
    expect(await replyVarsOf(dealId, NOW)).toEqual({ primeiroNome: "Maria", dataHorario: "quinta-feira, 22/10 às 15h", profissional: "Maiara", servico: "Mega hair teste" });
  });
  it("sem horário no lead, usa o próximo horário da cliente na agenda; passado e datas absurdas ficam de fora", async () => {
    await db.insert(appointments).values([
      { contactId, serviceLabel: "Escova", startsAt: new Date("2026-10-19T18:00:00Z"), status: "compareceu", externalKey: "t:passado" },
      { contactId, serviceLabel: "Corte", startsAt: new Date("2026-10-24T13:30:00Z"), status: "agendado", professionalId: pro, externalKey: "t:futuro" },
      { contactId, serviceLabel: "Mega", startsAt: new Date("2027-09-01T13:00:00Z"), status: "agendado", externalKey: "t:absurdo" },
    ]);
    expect(await replyVarsOf(dealId, NOW)).toEqual({ primeiroNome: "Maria", dataHorario: "sábado, 24/10 às 10h30", profissional: "Maiara", servico: "Corte" });
  });
  it("sem nenhum horário futuro, data e profissional ficam vazios", async () => {
    expect(await replyVarsOf(dealId, NOW)).toEqual({ primeiroNome: "Maria", dataHorario: null, profissional: null, servico: null });
  });
});
