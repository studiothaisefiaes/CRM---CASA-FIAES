import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../../db";
import { appointments, contacts, deals, messages, stages, tasks } from "../../db/schema";
import { resetDb } from "../../../../test/db";
import { syncFunnelFromAgenda } from "./funnel-sync";
import { applyAvecFiles } from "./apply";
import { buildXlsx, readXlsx } from "./xlsx";
import { setAppointmentStatus } from "../appointments";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador
const DAY = 86_400_000;
const rel = (days: number) => new Date(NOW.getTime() + days * DAY);
let n = 0;

beforeEach(async () => { n = 0; await resetDb(); });

async function cliente(o: { conversaHa?: number | null; stage?: string | null; scheduledAt?: Date | null; phone?: string } = {}) {
  n++;
  const [c] = await db.insert(contacts).values({ name: `Cliente${n} Teste`, phoneE164: o.phone ?? `+5571977${String(n).padStart(6, "0")}` }).returning();
  let dealId: string | null = null;
  if (o.stage !== null) {
    const [st] = await db.select().from(stages).where(eq(stages.key, o.stage ?? "atendimento"));
    const [d] = await db.insert(deals).values({ contactId: c.id, stageId: st.id, scheduledAt: o.scheduledAt ?? null, stageEnteredAt: rel(-5), createdAt: rel(-5) }).returning();
    dealId = d.id;
  }
  if (o.conversaHa !== null) await db.insert(messages).values({ contactId: c.id, dealId, direction: "in", body: "oi", status: "received", createdAt: rel(-(o.conversaHa ?? 2)) });
  return { contactId: c.id, dealId };
}
const horario = async (contactId: string, startsAt: Date, status: string) =>
  (await db.insert(appointments).values({ contactId, serviceLabel: "Corte", startsAt, status, externalKey: `t:${contactId}:${startsAt.toISOString()}:${status}` }).returning())[0];
const stageOf = async (id: string) => (await db.select({ k: stages.key }).from(deals).innerJoin(stages, eq(stages.id, deals.stageId)).where(eq(deals.id, id)))[0].k;
const dealOf = async (id: string) => (await db.select().from(deals).where(eq(deals.id, id)))[0];

describe("Avec → funil", () => {
  it("6B: gêmeo do Avec não move o funil", async () => {
    const c = await cliente();
    const crm = await horario(c.contactId, rel(3), "cancelado");
    await db.insert(appointments).values({ contactId: c.contactId, serviceLabel: "Corte", startsAt: rel(3), status: "agendado", externalKey: "avec:res:gemeo", avecTwinOf: crm.id });
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("atendimento");
  });

  it("6B + Na Casa: Chegou e Em atendimento nunca viram Aguardando; com a cliente no salão, a conversa vai para Na Casa", async () => {
    const c = await cliente();
    await horario(c.contactId, new Date(NOW.getTime() - 10 * 60_000), "chegou");
    expect(await syncFunnelFromAgenda({ now: NOW })).toMatchObject({ naCasa: 1, erros: [] });
    expect(await stageOf(c.dealId!)).toBe("na_casa");
  });

  it("Psico r68 #8: finalizou antes da hora marcada (entrou cedo): Atendida na hora, sai de Na Casa", async () => {
    const c = await cliente({ stage: "na_casa", scheduledAt: new Date(NOW.getTime() + 20 * 60_000) });
    await horario(c.contactId, new Date(NOW.getTime() + 20 * 60_000), "compareceu");
    expect(await syncFunnelFromAgenda({ now: NOW })).toMatchObject({ atendidas: 1, erros: [] });
    expect(await stageOf(c.dealId!)).toBe("atendida");
    expect((await dealOf(c.dealId!)).attendance).toBe("compareceu");
  });

  it("Na Casa desativada pela gestão: Chegou fica em Agendado (a regra de antes)", async () => {
    await db.update(stages).set({ active: false }).where(eq(stages.key, "na_casa"));
    const c = await cliente();
    await horario(c.contactId, new Date(NOW.getTime() - 10 * 60_000), "em_atendimento");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("agendado");
  });

  it("horário futuro (até 180 dias) leva para Agendado com a data do mais próximo; liga o horário ao lead", async () => {
    const c = await cliente();
    const a = await horario(c.contactId, rel(3), "agendado");
    await horario(c.contactId, rel(10), "confirmado");
    const r = await syncFunnelFromAgenda({ now: NOW });
    expect(r).toMatchObject({ agendados: 1, erros: [] });
    expect(await stageOf(c.dealId!)).toBe("agendado");
    expect((await dealOf(c.dealId!)).scheduledAt?.toISOString()).toBe(a.startsAt.toISOString());
    expect((await db.select().from(appointments).where(eq(appointments.id, a.id)))[0].dealId).toBe(c.dealId);
    expect(await db.select().from(tasks).where(and(eq(tasks.dealId, c.dealId!), eq(tasks.kind, "comparecimento"), isNull(tasks.doneAt)))).toHaveLength(1);
    expect(await syncFunnelFromAgenda({ now: NOW })).toMatchObject({ agendados: 0, datasAtualizadas: 0 }); // idempotente
  });

  it("horário a mais de 180 dias (data absurda do Avec) não conta", async () => {
    const c = await cliente();
    await horario(c.contactId, rel(400), "agendado");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("atendimento");
  });

  it("decisão 4: sem conversa nos últimos 30 dias, não mexe", async () => {
    const c = await cliente({ conversaHa: 40 });
    await horario(c.contactId, rel(3), "agendado");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("atendimento");
  });

  it("decisão 4: sem conversa aberta, ganha cartão em Agendado só se conversou nos últimos 30 dias", async () => {
    const com = await cliente({ stage: null, conversaHa: 2 });
    const sem = await cliente({ stage: null, conversaHa: 45 });
    await horario(com.contactId, rel(3), "agendado");
    await horario(sem.contactId, rel(3), "agendado");
    expect((await syncFunnelFromAgenda({ now: NOW })).cartoesNovos).toBe(1);
    const [novo] = await db.select().from(deals).where(eq(deals.contactId, com.contactId));
    expect(await stageOf(novo.id)).toBe("agendado");
    expect(await db.select().from(deals).where(eq(deals.contactId, sem.contactId))).toHaveLength(0);
  });

  it("compareceu no horário do lead → Atendida, com o pós-atendimento (visita recente)", async () => {
    const c = await cliente({ stage: "agendado", scheduledAt: rel(-1) });
    await horario(c.contactId, rel(-1), "compareceu");
    expect((await syncFunnelFromAgenda({ now: NOW })).atendidas).toBe(1);
    expect(await stageOf(c.dealId!)).toBe("atendida");
    expect((await dealOf(c.dealId!)).attendance).toBe("compareceu");
    expect((await db.select().from(tasks).where(and(eq(tasks.dealId, c.dealId!), eq(tasks.kind, "proxima_acao"), isNull(tasks.doneAt))))[0].title).toMatch(/^Pós-atendimento/);
  });

  it("faltou → Em conversa esperando a cliente, com Remarcar; cancelou (mesmo no futuro) → idem, sem marcar falta", async () => {
    const f = await cliente({ stage: "agendado", scheduledAt: rel(-1) });
    await horario(f.contactId, rel(-1), "faltou");
    const k = await cliente({ stage: "agendado", scheduledAt: rel(2) });
    await horario(k.contactId, rel(2), "cancelado");
    expect((await syncFunnelFromAgenda({ now: NOW })).aguardando).toBe(2);
    expect(await stageOf(f.dealId!)).toBe("atendimento");
    expect((await dealOf(f.dealId!)).attendance).toBe("faltou");
    expect(await stageOf(k.dealId!)).toBe("atendimento");
    expect((await dealOf(k.dealId!)).attendance).toBeNull();
  });

  it("Agendado feito só no CRM não é derrubado por uma falta antiga de outro dia", async () => {
    const c = await cliente({ stage: "agendado", scheduledAt: rel(5) });
    await horario(c.contactId, rel(-10), "faltou");
    await syncFunnelFromAgenda({ now: NOW });
    expect(await stageOf(c.dealId!)).toBe("agendado");
  });

  it("applyAvecFiles devolve o que mudou no funil", async () => {
    const c = await cliente({ phone: "+5571988880001" });
    const rows = await readXlsx(await buildXlsx([
      ["Data Cadastro Reserva", "Data Reserva", "Hora", "Cliente", "Celular", "Data Cadastro Cliente", "E-mail", "Profissional", "Serviço", "Origem", "Status", "Observação", "Data Comanda", "Número", "Quem Cadastrou"],
      ["01/10/2026 10:00", "20/10/2026", "09:30", "Cliente1 Teste", 71988880001, "", "", "MAIARA", "Corte Feminino", "Interno", "Agendado", "", "", "", "Recepção"],
    ]));
    const r = await applyAvecFiles([{ fileName: "reservas.xlsx", rows }], { now: NOW });
    expect(r.funil).toMatchObject({ agendados: 1 });
    expect(await stageOf(c.dealId!)).toBe("agendado");
  });

  it("Compareceu marcado na Agenda move o funil da cliente", async () => {
    const now = new Date();
    const c = await cliente({ stage: "agendado", scheduledAt: new Date(now.getTime() - 3_600_000) });
    await db.update(messages).set({ createdAt: new Date(now.getTime() - DAY) }).where(eq(messages.contactId, c.contactId));
    const a = await horario(c.contactId, new Date(now.getTime() - 3_600_000), "agendado");
    await setAppointmentStatus(a.id, "compareceu", null);
    expect(await stageOf(c.dealId!)).toBe("atendida");
  });
});
