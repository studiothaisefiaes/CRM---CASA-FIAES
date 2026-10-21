import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { agendaBlocks, alerts, appointments, contacts, professionals, proNotifications, settings, users } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { checkStart, freeSlots } from "@/lib/free-slots";
import { listAgendaBlocks } from "../../queries/avec";
import { resolvePro, type ProContext } from "../../queries/pro";
import { dayRulesPort } from "../agenda/ports";
import { decideLeave, listLeaveRequests, listMyLeaves, requestLeave } from "./leave";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const CASA = { 0: null, 1: null, 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["09:00", "18:00"] };
const FOLGA = { startsOn: "2026-10-20", endsOn: "2026-10-20", allDay: false, startTime: "14:00", endTime: "18:00", reason: "folga", note: "" };
const DIA = { from: bahia("2026-10-20", "00:00"), to: bahia("2026-10-21", "00:00") };
let maiara: ProContext;
let gestora = "";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(bahia("2026-10-15", "19:02"));
  await resetDb();
  await db.insert(settings).values([{ key: "business_hours", value: CASA }, { key: "agenda_modo", value: "dupla" }]);
  gestora = (await db.insert(users).values({ name: "Thaíse", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  const [u] = await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning();
  await db.insert(professionals).values({ name: "MAIARA", userId: u.id });
  maiara = (await resolvePro(u.id))!;
  const [paula] = await db.insert(contacts).values({ name: "Paula Souza", phoneE164: "+5571999990001" }).returning();
  await db.insert(appointments).values({ contactId: paula.id, clientName: "Paula Souza", professionalId: maiara.professionalId, serviceLabel: "Corte", startsAt: bahia("2026-10-20", "15:00"), durationMin: 60, status: "agendado", origin: "crm", externalKey: "t:1" });
});
afterEach(() => { vi.useRealTimers(); });

describe("pedido de folga pelo app (seção 8.4.4)", () => {
  it("nasce 'pedido', avisa a gestão no sino e aparece na lista da recepção com as clientes do período", async () => {
    const { id } = await requestLeave(maiara, FOLGA);
    const [b] = await db.select().from(agendaBlocks).where(eq(agendaBlocks.id, id));
    expect(b).toMatchObject({ requestStatus: "pedido", origin: "crm", externalKey: `crm:blq:${id}`, professionalId: maiara.professionalId, reason: "folga", requestedBy: maiara.userId });
    const [a] = await db.select().from(alerts).where(eq(alerts.dedupeKey, `folga:${id}`));
    expect(a).toMatchObject({ audience: "gestao", type: "folga_pedida", userId: null, message: "Maiara pediu folga em 20/10, das 14:00 às 18:00. Aprove ou recuse na Agenda." });
    expect(await listLeaveRequests()).toEqual([expect.objectContaining({ id, professional: "Maiara", title: "Folga", period: "20/10, das 14:00 às 18:00", clients: ["Paula 15:00 (20/10)"] })]);
    expect((await listMyLeaves(maiara)).map((l) => [l.status, l.period])).toEqual([["pedido", "20/10, das 14:00 às 18:00"]]);
  });

  it("pedido só avisa no motor; aprovado bloqueia; a grade da recepção só mostra o aprovado", async () => {
    const { id } = await requestLeave(maiara, FOLGA);
    const r = freeSlots(await dayRulesPort(db, maiara.professionalId, "2026-10-20"), { durationMin: 60, stepMin: 30 });
    if (!r.ok) throw new Error(r.reason);
    const s14 = r.slots.find((s) => s.start === 840);
    expect(s14?.kind).toBe("livre");
    expect(s14?.warnings.length).toBeGreaterThan(0);
    expect(await listAgendaBlocks(DIA)).toHaveLength(0);
    await decideLeave(id, "aprovar", null, gestora);
    expect(checkStart(await dayRulesPort(db, maiara.professionalId, "2026-10-20"), 840, { durationMin: 60 })).toMatchObject({ ok: false, reason: "bloqueado" });
    expect(await listAgendaBlocks(DIA)).toHaveLength(1);
  });

  it("aprovar no modo consulta é recusado; recusar exige motivo e vale em qualquer modo; recusado sai do motor", async () => {
    const { id } = await requestLeave(maiara, FOLGA);
    await db.update(settings).set({ value: "consulta" }).where(eq(settings.key, "agenda_modo"));
    await expect(decideLeave(id, "aprovar", null, gestora)).rejects.toThrow("A agenda do CRM está só para consulta");
    await expect(decideLeave(id, "recusar", " ", gestora)).rejects.toThrow("Escreva o motivo da recusa (ela vai ver).");
    await decideLeave(id, "recusar", "Dia de muito movimento", gestora);
    expect((await db.select().from(agendaBlocks).where(eq(agendaBlocks.id, id)))[0]).toMatchObject({ requestStatus: "recusado", decidedBy: gestora, decisionNote: "Dia de muito movimento" });
    expect((await dayRulesPort(db, maiara.professionalId, "2026-10-20")).blocks).toHaveLength(0);
  });

  it("a decisão avisa a profissional, resolve o aviso da gestão e não pode ser repetida", async () => {
    const { id } = await requestLeave(maiara, FOLGA);
    expect((await decideLeave(id, "aprovar", null, gestora)).clients).toEqual(["Paula 15:00 (20/10)"]);
    const [n] = await db.select().from(proNotifications);
    expect(n).toMatchObject({ kind: "folga_aprovada", title: "Folga aprovada", body: "Sua folga de 20/10, das 14:00 às 18:00 foi aprovada.", url: "/pro/folga" });
    expect((await db.select().from(alerts).where(eq(alerts.dedupeKey, `folga:${id}`)))[0].resolvedAt).not.toBeNull();
    await expect(decideLeave(id, "recusar", "mudei de ideia", gestora)).rejects.toThrow("Esse pedido já foi respondido.");
  });

  it("pedido inválido não grava nada", async () => {
    await expect(requestLeave(maiara, { ...FOLGA, startsOn: "2026-10-14", endsOn: "2026-10-14" })).rejects.toThrow("Escolha um dia de hoje em diante.");
    await expect(requestLeave(maiara, { ...FOLGA, reason: "outro", note: "" })).rejects.toThrow("Escreva o motivo.");
    expect(await db.select().from(agendaBlocks)).toHaveLength(0);
  });
});

it("revisão final: horário em 'conferir' (Avec que o CRM não conhece) aparece entre as clientes do período", async () => {
  await db.update(appointments).set({ status: "conferir", avecStatus: "Aguardando" }).where(eq(appointments.externalKey, "t:1"));
  await requestLeave(maiara, FOLGA);
  expect((await listLeaveRequests())[0].clients).toEqual(["Paula 15:00 (20/10)"]);
});
