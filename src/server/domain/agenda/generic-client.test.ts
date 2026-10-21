import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { appointments, contacts, deals, stages } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { ap, bahia, cliente, setupAgenda } from "../../../../test/agenda-fixtures";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { permsFor } from "../../../../test/perms";
import { assignDayVisits } from "./visits";
import { dayVisitsOf } from "../../queries/day-visit";
import { getAgenda } from "../../queries/agenda";
import { getToday } from "../../queries/today";
import { salonAttendance } from "../../reports/salon";
import { agendaRange } from "@/lib/agenda";
import { openComandaForAppointment } from "../caixa/comandas";
import { runLembreteD1, saveLembreteD1 } from "../client-link/reminder";
import { DEFAULT_REMINDER_TEXT, DEFAULT_RESCHEDULED_TEXT } from "../client-link/settings";
import { outbox } from "../../db/schema";
import { fazerVirada } from "../../../../test/virada";

// 17/10: a CLIENTE PADRÃO do Avec (cliente genérica, nunca com ficha) tinha 54 horários ativos em 30 dias e virava "visita", baixa e lembrete.
const PADRAO = { clientName: "CLIENTE PADRÃO", contactId: null };

describe("CLIENTE PADRÃO fica na grade e fora do que é de cliente", () => {
  let s: Awaited<ReturnType<typeof setupAgenda>>;
  beforeEach(async () => { await resetDb(); s = await setupAgenda(); });

  it("não vira visita (nem na importação, nem no job), e o quadro do dia (Hoje e Ao vivo) não a mostra", async () => {
    const p = await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, ...PADRAO });
    const real = await cliente("Paula Souza");
    const r = await ap({ startsAt: bahia(16, 9), professionalId: s.bia.id, contactId: real.contactId });
    await assignDayVisits();
    const [pv] = await db.select({ v: appointments.visitId }).from(appointments).where(eq(appointments.id, p.id));
    expect(pv.v).toBeNull();
    const day = await dayVisitsOf("2026-10-16", { withValues: false });
    expect(day.flatMap((v) => v.services.map((x) => x.appointmentId))).toEqual([r.id]);
  });

  it("a grade continua mostrando o horário (ocupa a profissional), marcado como genérico", async () => {
    await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, ...PADRAO });
    await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: (await cliente("Paula Souza")).contactId });
    const items = await getAgenda(agendaRange({ d: "2026-10-16" }, bahia(16, 8)), bahia(16, 8));
    expect(items.map((i) => [i.name, i.genericClient])).toEqual([["CLIENTE PADRÃO", true], ["Paula Souza", false]]);
  });

  it("relatório: horário sem desfecho da CLIENTE PADRÃO não conta", async () => {
    await ap({ startsAt: bahia(10, 9), professionalId: s.ana.id, ...PADRAO });
    await ap({ startsAt: bahia(10, 10), professionalId: s.ana.id, contactId: (await cliente("Paula Souza")).contactId });
    const r = await salonAttendance({ from: "2026-10-01", to: "2026-10-31" } as never, bahia(17, 9));
    expect(r.total.semDesfecho).toBe(1);
    expect(r.noOutcome.items.map((i) => i.clientName)).toEqual(["Paula Souza"]);
  });

  it("Hoje: nem na Agenda de hoje, nem em Na Casa agora", async () => {
    const now = bahia(16, 11);
    await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, status: "chegou", arrivedAt: bahia(16, 9), ...PADRAO });
    await ap({ startsAt: bahia(16, 15), professionalId: s.ana.id, ...PADRAO });
    const t = await getToday({ ...s.gestora, perms: permsFor("gestor"), profileId: null, profileName: "", availability: "ausente" } as never, now);
    expect(t.agenda).toHaveLength(0);
    expect(t.naCasa).toHaveLength(0);
  });
});

describe("CLIENTE PADRÃO: comanda e lembrete", () => {
  beforeEach(async () => { await resetDb(); });

  it("não abre comanda pelo horário (é venda de balcão)", async () => {
    const c = await setupCaixa();
    const p = await ap({ startsAt: bahia(16, 9), professionalId: c.ana.id, ...PADRAO });
    await expect(openComandaForAppointment(p.id, c.caixaRecepcao, bahia(16, 10))).rejects.toThrow(/CLIENTE PADRÃO/);
  });

  it("não recebe lembrete, nem com ficha e conversa no nome dela", async () => {
    const s = await setupAgenda();
    const now = bahia(14, 12);
    await fazerVirada("lembrete", s.gestora.id);
    await saveLembreteD1({ enabled: true, comLink: false, texto: DEFAULT_REMINDER_TEXT, textoRemarcado: DEFAULT_RESCHEDULED_TEXT }, s.gestora.id, { confirmouEnvio: true });
    const [c] = await db.insert(contacts).values({ name: "Cliente Padrão", phoneE164: "+5571999997777" }).returning();
    const [st] = await db.select().from(stages).where(eq(stages.key, "atendimento"));
    await db.insert(deals).values({ contactId: c.id, stageId: st.id });
    await ap({ startsAt: bahia(15, 14), professionalId: s.ana.id, contactId: c.id, clientName: "CLIENTE PADRÃO" });
    expect(await runLembreteD1(now)).toEqual({ enqueued: 0, skipped: 0 });
    expect(await db.select().from(outbox)).toHaveLength(0);
  });
});

describe("revisão final: horário sem nome nenhum não é a CLIENTE PADRÃO", () => {
  beforeEach(async () => { await resetDb(); });
  it("contato e horário sem nome continuam no quadro do dia e viram visita", async () => {
    const s = await setupAgenda();
    const [c] = await db.insert(contacts).values({ phoneE164: "+5571999990555" }).returning();
    const a = await ap({ startsAt: bahia(16, 9), professionalId: s.ana.id, contactId: c.id, clientName: null });
    const b = await ap({ startsAt: bahia(16, 10), professionalId: s.ana.id, contactId: null, clientName: null });
    await assignDayVisits();
    expect((await db.select({ v: appointments.visitId }).from(appointments).where(eq(appointments.id, a.id)))[0].v).not.toBeNull();
    const ids = (await dayVisitsOf("2026-10-16", { withValues: false })).flatMap((v) => v.services.map((x) => x.appointmentId));
    expect(ids.sort()).toEqual([a.id, b.id].sort());
  });
});
