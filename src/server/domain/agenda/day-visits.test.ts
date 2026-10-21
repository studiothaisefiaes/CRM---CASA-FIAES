import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, visits } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { assignDayVisits } from "./visits";

let s: Awaited<ReturnType<typeof setupAgenda>>;
beforeEach(async () => { await resetDb(); s = await setupAgenda(); });
const visitOf = async (id: string) => (await db.select({ v: appointments.visitId }).from(appointments).where(eq(appointments.id, id)))[0].v;

describe("visita por cliente e dia (17/10: 430 de 444 visitas do Avec estavam sem visita)", () => {
  it("junta os horários soltos da mesma cliente no dia numa visita só, reaproveita a que já existe e é idempotente", async () => {
    const paula = await cliente("Paula Souza");
    const a = await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, contactId: paula.contactId });
    const b = await ap({ startsAt: bahia(16, 9), professionalId: s.bia.id, contactId: paula.contactId, serviceLabel: "Hidratação" });
    const outroDia = await ap({ startsAt: bahia(17, 9), professionalId: s.ana.id, contactId: paula.contactId });
    const semFicha = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, clientName: "CLIENTE AVULSA" });
    const espera = await ap({ startsAt: bahia(16, 0), status: "espera", contactId: paula.contactId, externalKey: "avec:esp:x" });
    const cancelSemHora = await ap({ startsAt: bahia(16, 0), status: "cancelado", contactId: paula.contactId, externalKey: "avec:res:2026-10-16T--:--|paula|corte" });
    const [{ id: existente }] = await db.insert(visits).values({ contactId: paula.contactId, clientName: "Paula Souza", day: "2026-10-17", origin: "crm" }).returning();
    expect(await assignDayVisits()).toEqual({ appointments: 4, visits: 2 }); // a do dia 17 já existia
    expect(await visitOf(a.id)).toBe(await visitOf(b.id));
    expect(await visitOf(a.id)).not.toBeNull();
    expect(await visitOf(outroDia.id)).toBe(existente);
    expect(await visitOf(semFicha.id)).not.toBeNull();
    expect(await visitOf(espera.id)).toBeNull();
    expect(await visitOf(cancelSemHora.id)).toBeNull();
    expect(await assignDayVisits()).toEqual({ appointments: 0, visits: 0 });
  });
});
