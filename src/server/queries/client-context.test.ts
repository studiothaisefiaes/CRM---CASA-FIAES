import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contacts, deals, lists, professionals, stages, users } from "../db/schema";
import { clientContext } from "./client-context";
import { resetDb } from "../../../test/db";

const day = (n: number) => new Date(Date.now() - n * 86_400_000);

describe("contexto da cliente na hora de atender", () => {
  let contactId = "", currentId = "", bruna = "";
  beforeEach(async () => {
    await resetDb();
    const [c] = await db.insert(contacts).values({ name: "Cristiane Borges", phoneE164: "+5571990000012", createdAt: day(200) }).returning();
    contactId = c.id;
    const [lead] = await db.select().from(stages).where(eq(stages.key, "lead"));
    const [cur] = await db.insert(deals).values({ contactId, stageId: lead.id }).returning();
    currentId = cur.id;
    [{ id: bruna }] = await db.insert(users).values({ name: "Bruna Lima", email: "b@c.com", role: "atendente", passwordHash: "x" }).returning();
  });

  it("cliente nova: primeiro contato, sem visitas nem vendas", async () => {
    const x = await clientContext(contactId, currentId, { money: true });
    expect(x.isFirstContact).toBe(true);
    expect(x.visits).toBe(0);
    expect(x.lastVisit).toBeNull();
    expect(x.lastSales).toEqual([]);
    expect(x.totalCents).toBe(0);
    expect(x.previousOwner).toBeNull();
    expect(x.nextAppointment).toBeNull();
    expect(x.activePackage).toBeNull();
  });

  it("cliente da casa: visitas, últimas vendas, total e quem atendeu antes; sem 'ver valores', nenhum R$", async () => {
    const [fechado] = await db.select().from(stages).where(eq(stages.key, "fechado"));
    const [svc] = await db.insert(lists).values({ kind: "service", label: "Corte + escova", position: 99 }).returning();
    await db.insert(deals).values([
      { contactId, stageId: fechado.id, closedAt: day(90), createdAt: day(91), valueCents: 18_000, serviceId: svc.id, ownerId: bruna, scheduledAt: day(90), attendance: "compareceu" },
      { contactId, stageId: fechado.id, closedAt: day(30), createdAt: day(31), valueCents: 48_000, serviceId: null, ownerId: bruna, scheduledAt: day(30), attendance: "compareceu" },
    ]);
    const x = await clientContext(contactId, currentId, { money: true });
    expect(x.isFirstContact).toBe(false);
    expect(x.visits).toBe(2);
    expect(x.totalCents).toBe(66_000);
    expect(x.lastSales.map((s) => s.valueCents)).toEqual([48_000, 18_000]);
    expect(x.lastSales[1].service).toBe("Corte + escova");
    expect(x.lastVisit?.by).toBe("Bruna Lima");
    expect(x.previousOwner).toBe("Bruna Lima");
    expect(new Date(x.firstContactAt).getTime()).toBeLessThanOrEqual(day(199).getTime());

    const semValor = await clientContext(contactId, currentId, { money: false });
    expect(semValor.totalCents).toBeNull();
    expect(semValor.lastSales.every((s) => s.valueCents === null)).toBe(true);
  });

  it("do Avec: próximo horário marcado (não cancelado, não passado) e o pacote ativo que vence antes", async () => {
    const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
    const em = (dias: number) => new Date(Date.now() + dias * 86_400_000);
    await db.insert(appointments).values([
      { contactId, serviceLabel: "Corte", startsAt: em(-2), status: "compareceu", externalKey: "t:1" },
      { contactId, serviceLabel: "Unha", startsAt: em(1), status: "cancelado", externalKey: "t:2" },
      { contactId, serviceLabel: "Escova", startsAt: em(3), status: "confirmado", professionalId: maiara.id, externalKey: "t:3" },
      { contactId, serviceLabel: "Hidratação", startsAt: em(9), status: "agendado", externalKey: "t:4" },
    ]);
    const dia = (n: number) => em(n).toISOString().slice(0, 10);
    await db.insert(clientPackages).values([
      { contactId, packageName: "Escova 5x", totalSessions: 5, usedSessions: 5, validUntil: dia(60), externalKey: "p:1" },
      { contactId, packageName: "Hidratação 10x", totalSessions: 10, usedSessions: 3, validUntil: dia(90), externalKey: "p:2" },
      { contactId, packageName: "Velho", totalSessions: 4, usedSessions: 1, validUntil: dia(-5), externalKey: "p:3" },
    ]);
    const x = await clientContext(contactId, currentId, { money: false });
    expect(x.nextAppointment).toMatchObject({ serviceLabel: "Escova", professionalName: "MAIARA" });
    expect(new Date(x.nextAppointment!.startsAt).getTime()).toBeGreaterThan(Date.now());
    expect(x.activePackage).toEqual({ packageName: "Hidratação 10x", usedSessions: 3, totalSessions: 10 });
  });

  it("pacote do Avec em várias linhas (uma por serviço): o painel e a frase usam a compra (maior usado / maior total)", async () => {
    const dia = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const combo = { contactId, packageName: "Combo Manutenção Método Fiaes", totalSessions: 4, priceCents: 800000, purchasedOn: dia(-30), validUntil: dia(300) };
    await db.insert(clientPackages).values([
      { ...combo, serviceLabel: "Sessão de pacote metodo", usedSessions: 0, externalKey: "c:1" },
      { ...combo, serviceLabel: "Finalização Metodo Fiaes", usedSessions: 1, externalKey: "c:2" },
    ]);
    const x = await clientContext(contactId, currentId, { money: false });
    expect(x.activePackage).toEqual({ packageName: "Combo Manutenção Método Fiaes", usedSessions: 1, totalSessions: 4 });
    expect(x.situation).toContain("pacote 1/4");
  });
});
