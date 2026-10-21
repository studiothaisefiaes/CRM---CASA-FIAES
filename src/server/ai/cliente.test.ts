import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { eq } from "drizzle-orm";
import { agendaBlocks, appointments, contactStats, deals, professionals } from "../db/schema";
import { resetDb } from "../../../test/db";
import { recordInbound, recordOutbound } from "../domain/deals";
import { formatAusencias, loadAusencias, loadClienteContext } from "./cliente";
import type { BusinessHours } from "@/lib/business-hours";

// Casa de terça a sábado, 9h–18h (domingo e segunda fechado), como a Casa Fiaes.
const HOURS: BusinessHours = { "0": null, "1": null, "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"], "6": ["09:00", "18:00"] };
const b = (pro: string, startsOn: string, endsOn: string, startTime = "08:00", endTime = "20:00", weekdays: number[] | null = null) => ({ pro, startsOn, endsOn, startTime, endTime, weekdays });

describe("ausências das profissionais (pura)", () => {
  it("dia inteiro vira faixa; parte do dia com horário; almoço e Casa fechada não entram", () => {
    // 20/10/2026 é terça.
    expect(formatAusencias([
      b("THAISE FIAES", "2026-10-20", "2026-10-22"),
      b("ilma santos", "2026-10-24", "2026-10-24", "13:00", "18:00"),
      b("Jackson", "2026-10-01", "2026-12-31", "12:00", "13:00"), // almoço
      b("Maiara", "2026-10-26", "2026-10-26"), // segunda: Casa fechada
    ], "2026-10-20", HOURS)).toEqual(["Ilma Santos fora 24/10 das 13h às 18h", "Thaise Fiaes fora de 20 a 22/10"]);
  });
  it("sábado e terça seguidos (domingo e segunda fechados) viram uma faixa; mês diferente; dia da semana do bloqueio", () => {
    expect(formatAusencias([b("Gilvan", "2026-10-24", "2026-10-27")], "2026-10-21", HOURS)).toEqual(["Gilvan fora de 24 a 27/10"]);
    expect(formatAusencias([b("Gilvan", "2026-10-30", "2026-11-03")], "2026-10-28", HOURS)).toEqual(["Gilvan fora de 30/10 a 03/11"]);
    expect(formatAusencias([b("Rose", "2026-10-01", "2026-12-31", "08:00", "20:00", [3])], "2026-10-20", HOURS)).toEqual(["Rose fora 21/10"]);
    expect(formatAusencias([b("Rose", "2026-10-28", "2026-10-30")], "2026-10-20", HOURS)).toEqual([]); // depois dos 7 dias
  });
});

describe("contexto da cliente (banco)", () => {
  const T = new Date("2026-10-20T13:00:00Z");
  let contactId = "";
  beforeEach(async () => {
    await resetDb();
    const r = await recordInbound({ channelId: null, externalId: "C1", phoneRaw: "71999770001", pushName: "Ana", body: "Oi", at: new Date(T.getTime() - 3 * 86_400_000), now: T });
    if (!("dealId" in r)) throw new Error("sem conversa");
    contactId = (await db.select({ c: deals.contactId }).from(deals).where(eq(deals.id, r.dealId)))[0].c;
  });
  it("cliente nova: zero visitas, sem fotos nem estimativa", async () => {
    expect(await loadClienteContext(contactId, T)).toEqual({ visitas: 0, ultimaVisita: null, ultimaManutencaoMetodo: null, fotos: 0, estimativaMetodo: false });
  });
  it("visitas, última visita e serviço, última manutenção do Método, fotos e estimativa; nada do futuro", async () => {
    const r = await recordInbound({ channelId: null, externalId: "C2", phoneRaw: "71999770001", kind: "image", body: null, at: new Date(T.getTime() - 86_400_000), now: T });
    await recordInbound({ channelId: null, externalId: "C3", phoneRaw: "71999770001", kind: "image", body: "minha raiz", at: new Date(T.getTime() - 86_000_000), now: T });
    await recordOutbound({ dealId: (r as { dealId: string }).dealId, channelId: null, body: "A estimativa do seu Método Fiaes® fica em R$ 6.000,00.", fromPhone: true, at: new Date(T.getTime() - 3_600_000) });
    await db.insert(contactStats).values({ contactId, visits: 4, lastVisitOn: "2026-09-12" });
    await db.insert(appointments).values([
      { contactId, startsAt: new Date("2026-09-01T13:00:00Z"), serviceLabel: "Manutenção Método Fiaes", status: "compareceu", externalKey: "a1" },
      { contactId, startsAt: new Date("2026-09-12T13:00:00Z"), serviceLabel: "Corte", status: "compareceu", externalKey: "a2" },
      { contactId, startsAt: new Date("2026-10-25T13:00:00Z"), serviceLabel: "Escova", status: "agendado", externalKey: "a3" },
    ] as never);
    expect(await loadClienteContext(contactId, T)).toEqual({ visitas: 4, ultimaVisita: { dia: "2026-09-12", servico: "Corte" }, ultimaManutencaoMetodo: "2026-09-01", fotos: 2, estimativaMetodo: true });
    // A avaliação corta a conversa antes: o que veio depois não conta.
    expect(await loadClienteContext(contactId, new Date("2026-09-05T12:00:00Z"))).toEqual({ visitas: 1, ultimaVisita: { dia: "2026-09-01", servico: "Manutenção Método Fiaes" }, ultimaManutencaoMetodo: "2026-09-01", fotos: 0, estimativaMetodo: false });
  });
  it("valor qualquer na mensagem assinada \"CASA FIAES\" não é estimativa do Método (20/10: o manicure virava estimativa)", async () => {
    const [d] = await db.select({ id: deals.id }).from(deals).where(eq(deals.contactId, contactId));
    await recordOutbound({ dealId: d.id, channelId: null, body: "*SARA - CASA FIAES:*\nO investimento para manicure é de R$ 60,00", fromPhone: true, at: new Date(T.getTime() - 3_600_000) });
    expect((await loadClienteContext(contactId, T)).estimativaMetodo).toBe(false);
    await recordOutbound({ dealId: d.id, channelId: null, body: "*CATI - CASA FIAES:*\nSegue uma estimativa do investimento para a sua transformação: entre R$ 16.000,00 e R$ 24.000,00.", fromPhone: true, at: new Date(T.getTime() - 1_800_000) });
    expect((await loadClienteContext(contactId, T)).estimativaMetodo).toBe(true);
  });
  it("ausências pela agenda: só ativas, sem apagados, recusados e almoço", async () => {
    const [thaise, ex] = await db.insert(professionals).values([{ name: "THAISE FIAES" }, { name: "Saiu", active: false }]).returning();
    await db.insert(agendaBlocks).values([
      { professionalId: thaise.id, title: "Curso", reason: "curso", startsOn: "2026-10-20", endsOn: "2026-10-22", startTime: "08:00", endTime: "20:00", externalKey: "x1" },
      { professionalId: thaise.id, title: "Folga", startsOn: "2026-10-24", endsOn: "2026-10-24", startTime: "08:00", endTime: "20:00", externalKey: "x2", deletedAt: T },
      { professionalId: thaise.id, title: "Pedido", startsOn: "2026-10-23", endsOn: "2026-10-23", startTime: "08:00", endTime: "20:00", externalKey: "x3", requestStatus: "recusado" },
      { professionalId: thaise.id, title: "Almoço longo", reason: "almoco", startsOn: "2026-10-23", endsOn: "2026-10-23", startTime: "08:00", endTime: "20:00", externalKey: "x4" },
      { professionalId: ex.id, title: "Folga", startsOn: "2026-10-21", endsOn: "2026-10-21", startTime: "08:00", endTime: "20:00", externalKey: "x5" },
    ]);
    expect(await loadAusencias(T)).toEqual(["Thaise Fiaes fora de 20 a 22/10"]);
  });
});
