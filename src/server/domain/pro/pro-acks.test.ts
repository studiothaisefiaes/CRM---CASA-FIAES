import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, professionals, proNotifications, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { resolvePro, type ProContext } from "../../queries/pro";
import { ackDay, dayAcks } from "./acks";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
let maiara: ProContext;
let apId = "";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(bahia("2026-10-15", "19:02"));
  await resetDb();
  const [u] = await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(professionals).values({ name: "MAIARA", userId: u.id });
  maiara = (await resolvePro(u.id))!;
  apId = (await db.insert(appointments).values({ clientName: "Paula", professionalId: maiara.professionalId, serviceLabel: "Corte", startsAt: bahia("2026-10-16", "10:00"),
    status: "agendado", origin: "crm", externalKey: "t:1", updatedAt: bahia("2026-10-15", "12:00") }).returning())[0].id;
});
afterEach(() => { vi.useRealTimers(); });

describe("'Vi minha agenda de amanhã' (seção 8.4.5)", () => {
  it("grava a hora; sem mudança depois, não acusa nada", async () => {
    await ackDay(maiara, "2026-10-16");
    expect(await dayAcks("2026-10-16")).toEqual({ [maiara.professionalId]: { ackedAt: bahia("2026-10-15", "19:02").toISOString(), changedAfter: false } });
  });

  it("horário dela daquele dia mexido depois do 'vi' aparece como mudou", async () => {
    await ackDay(maiara, "2026-10-16");
    vi.setSystemTime(bahia("2026-10-15", "20:00"));
    await db.update(appointments).set({ notes: "trazer foto", updatedAt: new Date() }).where(eq(appointments.id, apId));
    expect((await dayAcks("2026-10-16"))[maiara.professionalId].changedAfter).toBe(true);
  });

  it("horário que saiu da agenda dela (aviso daquele dia) também conta; outro dia não", async () => {
    await ackDay(maiara, "2026-10-16");
    await db.insert(proNotifications).values({ userId: maiara.userId, professionalId: maiara.professionalId, kind: "remarcado", title: "Saiu da sua agenda", body: "x",
      url: "/pro/dia/2026-10-16", dedupeKey: "k1", createdAt: bahia("2026-10-15", "20:00") });
    expect((await dayAcks("2026-10-16"))[maiara.professionalId].changedAfter).toBe(true);
    expect(await dayAcks("2026-10-17")).toEqual({});
  });

  it("ver de novo atualiza a hora e zera o 'mudou'", async () => {
    await ackDay(maiara, "2026-10-16");
    vi.setSystemTime(bahia("2026-10-15", "20:00"));
    await db.update(appointments).set({ updatedAt: new Date() }).where(eq(appointments.id, apId));
    vi.setSystemTime(bahia("2026-10-15", "21:00"));
    await ackDay(maiara, "2026-10-16");
    expect((await dayAcks("2026-10-16"))[maiara.professionalId]).toEqual({ ackedAt: bahia("2026-10-15", "21:00").toISOString(), changedAfter: false });
  });
});
