import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, deals, professionals, stages, users, lists } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { recordInbound } from "../deals";
import { moveToKindTx } from "../deals";
import { markRescheduled } from "./remarcou";

const T0 = new Date("2026-10-20T13:00:00Z");
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
let dealId = "", contactId = "", userId = "", proId = "", serviceId = "";

async function horario(startsAt: Date) {
  const [a] = await db.insert(appointments).values({ contactId, clientName: "Paula", professionalId: proId, serviceId, serviceLabel: "Corte", startsAt, durationMin: 60, status: "agendado", origin: "crm", externalKey: `crm:${startsAt.getTime()}`, dealId }).returning();
  return a.id;
}

beforeEach(async () => {
  await resetDb();
  [{ id: userId }] = await db.insert(users).values({ name: "Sara", email: "s@t.local", role: "atendente", passwordHash: "x" }).returning();
  [{ id: proId }] = await db.insert(professionals).values({ name: "Ana" }).returning();
  [{ id: serviceId }] = await db.select({ id: lists.id }).from(lists).where(eq(lists.kind, "service")).limit(1);
  const r = await recordInbound({ channelId: null, externalId: "R1", phoneRaw: "71999990072", pushName: "Paula", body: "oi", at: T0, now: T0 });
  if (!("dealId" in r)) throw new Error("sem conversa");
  dealId = r.dealId;
  [{ contactId }] = await db.select({ contactId: deals.contactId }).from(deals).where(eq(deals.id, dealId));
  await db.transaction((tx) => moveToKindTx(tx, dealId, "agendado", userId, "teste", T0));
  await db.update(deals).set({ scheduledAt: at(1) }).where(eq(deals.id, dealId));
});

const kind = async () => (await db.select({ k: stages.kind }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, dealId)))[0].k;

describe("Remarcou no Ela veio?", () => {
  it("sem horário novo: cancela como remarcado, não conta falta e sai de Agendado", async () => {
    const id = await horario(at(1));
    expect(await markRescheduled(dealId, userId, at(2))).toEqual({ temNovo: false });
    const [a] = await db.select().from(appointments).where(eq(appointments.id, id));
    expect(a).toMatchObject({ status: "cancelado", cancelReason: "remarcado" });
    const [d] = await db.select({ attendance: deals.attendance }).from(deals).where(eq(deals.id, dealId));
    expect(d.attendance).not.toBe("faltou");
    expect(await kind()).not.toBe("agendado");
  });
  it("com horário novo: o antigo sai e o novo fica", async () => {
    const velho = await horario(at(1)), novo = await horario(at(48));
    expect(await markRescheduled(dealId, userId, at(2))).toEqual({ temNovo: true });
    const rows = await db.select().from(appointments);
    expect(rows.find((r) => r.id === velho)?.status).toBe("cancelado");
    expect(rows.find((r) => r.id === novo)?.status).toBe("agendado");
  });
  it("horário só na conversa: também sai de Agendado", async () => {
    expect(await markRescheduled(dealId, userId, at(2))).toEqual({ temNovo: false });
    expect(await kind()).not.toBe("agendado");
  });
});
