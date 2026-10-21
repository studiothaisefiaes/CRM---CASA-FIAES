import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { agendaBlocks, appointments, avecReports, clientPackages, contacts, professionals, salesItems, salesPayments, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import {
  getAvecReport, getAvecReportTable, getContactAvecData, listAgendaBlocks, listAppointments, listAvecReports, listClientPackages, listWaitlist, nextAppointmentsOf,
} from "./avec";

beforeEach(async () => { await resetDb(); });

const NOW = new Date(Date.UTC(2026, 9, 14, 15, 0)); // quarta 14/10, 12h em Salvador
const bahia = (day: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, day, h + 3, m));
const dayRange = (day: number) => ({ from: bahia(day, 0), to: bahia(day + 1, 0) });
let k = 0;
const key = () => `teste:${++k}`;

async function base() {
  const [ana] = await db.insert(contacts).values({ name: "Ana Teste", phoneE164: "+5571988880001" }).returning();
  const [maiara] = await db.insert(professionals).values({ name: "MAIARA" }).returning();
  const [jo] = await db.insert(professionals).values({ name: "JO" }).returning();
  return { ana, maiara, jo };
}

describe("listAppointments / listWaitlist", () => {
  it("horários do dia em ordem, com nome da ficha (ou o do Avec), profissional; espera fica de fora; filtro por profissional", async () => {
    const { ana, maiara, jo } = await base();
    await db.insert(appointments).values([
      { externalKey: key(), contactId: ana.id, clientName: "Ana do Avec", professionalId: maiara.id, serviceLabel: "Corte", startsAt: bahia(14, 15), status: "agendado", priceCents: 15000 },
      { externalKey: key(), clientName: "Bia Teste", professionalId: jo.id, serviceLabel: "Manicure", startsAt: bahia(14, 9), status: "compareceu" },
      { externalKey: key(), clientName: "Cris Teste", serviceLabel: "Escova", startsAt: bahia(14, 10), status: "cancelado" },
      { externalKey: key(), clientName: "Fora", serviceLabel: "Escova", startsAt: bahia(15, 0, 30), status: "agendado" },
      { externalKey: key(), clientName: "Espera", serviceLabel: "Coloração", startsAt: bahia(14, 0), status: "espera" },
    ]);
    const day = await listAppointments(dayRange(14));
    expect(day.map((a) => [a.clientName, a.status, a.professionalName])).toEqual([["Bia Teste", "compareceu", "JO"], ["Cris Teste", "cancelado", null], ["Ana Teste", "agendado", "MAIARA"]]);
    expect(day[2]).toMatchObject({ phone: "+5571988880001", priceCents: null, serviceLabel: "Corte", origin: "avec", startsAt: bahia(14, 15).toISOString() });
    expect((await listAppointments(dayRange(14), { withValues: true }))[2].priceCents).toBe(15000);
    expect((await listAppointments(dayRange(14), { professionalId: maiara.id })).map((a) => a.clientName)).toEqual(["Ana Teste"]);
    expect(await listAppointments(dayRange(14), { professionalId: "x" })).toEqual([]);
    expect((await listWaitlist()).map((a) => [a.clientName, a.status])).toEqual([["Espera", "espera"]]);
  });

  it("o lixo do 0248 (\"espera\" do Avec às 00:00) não aparece na Lista de espera; a espera do CRM continua (QA r58, gap A1)", async () => {
    await db.insert(appointments).values([
      { externalKey: "avec:esp:2026-10-14|lixo|corte", clientName: "Lixo Avec", serviceLabel: "Corte", startsAt: bahia(14, 0), status: "espera", origin: "avec" },
      { externalKey: key(), clientName: "Espera CRM", serviceLabel: "Corte", startsAt: bahia(14, 0), status: "espera", origin: "crm" },
    ]);
    expect((await listWaitlist()).map((a) => a.clientName)).toEqual(["Espera CRM"]);
  });

  it("lista de espera a partir de um dia: pedidos antigos (o Avec traz desde 2020) ficam de fora", async () => {
    await db.insert(appointments).values([
      { externalKey: key(), clientName: "Antiga", serviceLabel: "Corte", startsAt: new Date(Date.UTC(2020, 0, 17, 3)), status: "espera" },
      { externalKey: key(), clientName: "Hoje", serviceLabel: "Corte", startsAt: bahia(14, 0), status: "espera" },
      { externalKey: key(), clientName: "Amanhã", serviceLabel: "Corte", startsAt: bahia(15, 0), status: "espera" },
    ]);
    expect((await listWaitlist({ from: bahia(14, 0) })).map((a) => a.clientName)).toEqual(["Hoje", "Amanhã"]);
  });
});

describe("listAgendaBlocks", () => {
  it("bloqueios que tocam o período (dia de Salvador), com o nome da profissional", async () => {
    const { maiara } = await base();
    await db.insert(agendaBlocks).values([
      { externalKey: key(), professionalId: maiara.id, title: "Almoço", startsOn: "2026-10-01", endsOn: "2026-12-31", startTime: "12:00", endTime: "13:00", weekdays: [2] },
      { externalKey: key(), title: "Feriado", startsOn: "2026-10-12", endsOn: "2026-10-12", startTime: "08:00", endTime: "20:00" },
      { externalKey: key(), title: "Depois", startsOn: "2026-10-15", endsOn: "2026-10-16", startTime: "08:00", endTime: "09:00" },
    ]);
    const b = await listAgendaBlocks(dayRange(14));
    expect(b.map((x) => [x.title, x.professionalName, x.weekdays])).toEqual([["Almoço", "MAIARA", [2]]]);
    expect((await listAgendaBlocks({ from: bahia(12, 0), to: bahia(19, 0) })).map((x) => x.title).sort()).toEqual(["Almoço", "Depois", "Feriado"]);
  });
});

describe("listClientPackages", () => {
  it("situação (acabando, vencendo, vencido, esgotado), próximo horário da cliente e filtros", async () => {
    const { ana } = await base();
    await db.insert(clientPackages).values([
      { externalKey: key(), contactId: ana.id, clientName: "Ana Teste", packageName: "Hidratação 5x", totalSessions: 5, usedSessions: 4, validUntil: "2027-03-01", priceCents: 40000 },
      { externalKey: key(), clientName: "Bia Teste", packageName: "Escova 10x", totalSessions: 10, usedSessions: 2, validUntil: "2026-10-30" },
      { externalKey: key(), clientName: "Cris Teste", packageName: "Escova 10x", totalSessions: 10, usedSessions: 2, validUntil: "2026-09-30" },
      { externalKey: key(), clientName: "Dora Teste", packageName: "Corte 3x", totalSessions: 3, usedSessions: 3 },
      { externalKey: key(), clientName: "Eva Teste", packageName: "Corte 3x", totalSessions: 3, usedSessions: 0 },
    ]);
    await db.insert(appointments).values([
      { externalKey: key(), contactId: ana.id, serviceLabel: "Hidratação", startsAt: bahia(20, 9), status: "agendado" },
      { externalKey: key(), contactId: ana.id, serviceLabel: "Hidratação", startsAt: bahia(16, 9), status: "cancelado" },
      { externalKey: key(), contactId: ana.id, serviceLabel: "Hidratação", startsAt: bahia(10, 9), status: "compareceu" },
    ]);
    const ativos = await listClientPackages({}, NOW);
    expect(ativos.map((p) => [p.clientName, p.situation, p.remaining])).toEqual([["Bia Teste", "vencendo", 8], ["Ana Teste", "acabando", 1], ["Eva Teste", "ativo", 3]]);
    expect(ativos[1]).toMatchObject({ nextAppointmentAt: bahia(20, 9).toISOString(), priceCents: null, endingSoon: true, expiringSoon: false, phone: "+5571988880001" });
    expect((await listClientPackages({ situacao: "encerrados" }, NOW)).map((p) => [p.clientName, p.situation])).toEqual([["Cris Teste", "vencido"], ["Dora Teste", "esgotado"]]);
    expect((await listClientPackages({ situacao: "acabando" }, NOW)).map((p) => p.clientName)).toEqual(["Ana Teste"]);
    expect((await listClientPackages({ situacao: "vencendo" }, NOW)).map((p) => p.clientName)).toEqual(["Bia Teste"]);
    expect((await listClientPackages({ q: "escova", situacao: "todos" }, NOW)).map((p) => p.clientName)).toEqual(["Cris Teste", "Bia Teste"]);
    expect((await listClientPackages({ contactId: ana.id, withValues: true }, NOW)).map((p) => p.priceCents)).toEqual([40000]);
  });

  it("uma compra do Avec em várias linhas (uma por serviço) é UM pacote: contagem, filtros, busca e uso de cada serviço", async () => {
    const { ana } = await base();
    const combo = { contactId: ana.id, clientName: "Ana Teste", packageName: "Combo Manutenção Método Fiaes", totalSessions: 4, priceCents: 800000, purchasedOn: "2025-12-09", validUntil: "2026-12-09" };
    const duo = { clientName: "Fê Teste", packageName: "Combo Manutenção Método Fiaes", totalSessions: 4, priceCents: 800000, purchasedOn: "2026-10-01", validUntil: "2026-10-31" };
    await db.insert(clientPackages).values([
      { ...combo, externalKey: key(), serviceLabel: "Finalização Metodo Fiaes", usedSessions: 1 },
      { ...combo, externalKey: key(), serviceLabel: "Confeção Metodo Fiaes", usedSessions: 2 },
      { ...combo, externalKey: key(), serviceLabel: "Meia Aplicação Metodo Fiaes", usedSessions: 3 },
      { ...combo, externalKey: key(), serviceLabel: "Confecção Cabelo Metodo Fiaes", usedSessions: 1 },
      // Outro pacote da mesma cliente (outra compra): continua separado.
      { ...combo, externalKey: key(), serviceLabel: "Finalização Metodo Fiaes", usedSessions: 0, purchasedOn: "2026-09-01", validUntil: "2027-09-01" },
      { ...duo, externalKey: key(), serviceLabel: "Sessão de pacote metodo", usedSessions: 0 },
      { ...duo, externalKey: key(), serviceLabel: "Finalização Metodo Fiaes", usedSessions: 0 },
    ]);
    const ativos = await listClientPackages({ withValues: true }, NOW);
    expect(ativos.map((p) => [p.clientName, p.purchasedOn, p.usedSessions, p.totalSessions, p.remaining, p.situation])).toEqual([
      ["Fê Teste", "2026-10-01", 0, 4, 4, "vencendo"], ["Ana Teste", "2025-12-09", 3, 4, 1, "acabando"], ["Ana Teste", "2026-09-01", 0, 4, 4, "ativo"],
    ]);
    expect(ativos[0].services.map((s) => `${s.label} ${s.usedSessions}/${s.totalSessions}`)).toEqual(["Finalização Método Fiaes 0/4", "Sessão de Pacote Método 0/4"]);
    expect(ativos[1]).toMatchObject({ priceCents: 800000, endingSoon: true, serviceLabel: null });
    expect(ativos[1].services).toHaveLength(4);
    expect(ativos[1].rowIds).toHaveLength(4);
    expect((await listClientPackages({ situacao: "acabando" }, NOW)).map((p) => p.purchasedOn)).toEqual(["2025-12-09"]);
    expect((await listClientPackages({ situacao: "vencendo" }, NOW)).map((p) => p.clientName)).toEqual(["Fê Teste"]);
    expect((await listClientPackages({ q: "meia aplicacao" }, NOW)).map((p) => p.purchasedOn)).toEqual(["2025-12-09"]);
    expect(await listClientPackages({ contactId: ana.id }, NOW)).toHaveLength(2);
  });
});

describe("getContactAvecData / nextAppointmentsOf", () => {
  it("próximos horários (sem cancelados), pacotes, histórico e pagamentos, mais novos primeiro; valores só com withValues", async () => {
    const { ana, maiara } = await base();
    await db.insert(appointments).values([
      { externalKey: key(), contactId: ana.id, serviceLabel: "Corte", startsAt: bahia(20, 9), status: "agendado", professionalId: maiara.id },
      { externalKey: key(), contactId: ana.id, serviceLabel: "Escova", startsAt: bahia(18, 9), status: "cancelado" },
      { externalKey: key(), contactId: ana.id, serviceLabel: "Escova", startsAt: bahia(10, 9), status: "compareceu" },
    ]);
    await db.insert(clientPackages).values({ externalKey: key(), contactId: ana.id, clientName: "Ana Teste", packageName: "Corte 3x", totalSessions: 3, usedSessions: 3 });
    await db.insert(salesItems).values([
      { externalKey: key(), contactId: ana.id, soldOn: "2026-10-01", comanda: "1001", item: "Corte", kind: "servico", professionalName: "MAIARA DA SILVA TESTE", professionalId: maiara.id, valueCents: 15000, totalCents: 15000 },
      { externalKey: key(), contactId: ana.id, soldOn: "2026-10-05", comanda: "1002", item: "Shampoo", kind: "produto", professionalName: "X", valueCents: 8000, qty: 2, totalCents: 16000 },
    ]);
    await db.insert(salesPayments).values([
      { externalKey: key(), contactId: ana.id, comanda: "1001", comandaOn: "2026-10-01", paidOn: "2026-10-01", method: "Pix", valueCents: 15000 },
      { externalKey: key(), contactId: ana.id, comanda: "1002", comandaOn: "2026-10-05", paidOn: "2026-10-05", method: "Dinheiro", valueCents: 16000 },
    ]);
    const d = await getContactAvecData(ana.id, { now: NOW });
    expect(d.proximos.map((a) => [a.serviceLabel, a.professionalName])).toEqual([["Corte", "MAIARA"]]);
    expect(d.pacotes.map((p) => p.situation)).toEqual(["esgotado"]);
    expect(d.historico.map((h) => [h.soldOn, h.item, h.professionalName, h.qty, h.valueCents])).toEqual([["2026-10-05", "Shampoo", "X", 2, null], ["2026-10-01", "Corte", "MAIARA", 1, null]]);
    expect(d.pagamentos.map((p) => [p.method, p.valueCents])).toEqual([["Dinheiro", null], ["Pix", null]]);
    const v = await getContactAvecData(ana.id, { now: NOW, withValues: true });
    expect(v.historico[0].valueCents).toBe(8000);
    expect(v.pagamentos[0].valueCents).toBe(16000);
    expect(d.totais).toEqual({ comandas: 2, totalCents: null });
    expect(v.totais).toEqual({ comandas: 2, totalCents: 31000 });
    expect(await getContactAvecData("nao-e-uuid")).toEqual({ proximos: [], pacotes: [], historico: [], pagamentos: [], totais: { comandas: 0, totalCents: null } });
    const next = await nextAppointmentsOf([ana.id], NOW);
    expect(next.get(ana.id)?.serviceLabel).toBe("Corte");
  });
});

describe("relatórios do Avec", () => {
  it("lista (sem as linhas), abre com busca sem acento e paginação, e entrega a tabela inteira para baixar", async () => {
    const [u] = await db.insert(users).values({ name: "Gestora", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const rows = Array.from({ length: 120 }, (_, i) => [`0${(i % 9) + 1}/10/2026`, i === 7 ? "Conceição Teste" : `Cliente ${i}`]);
    const [rep] = await db.insert(avecReports).values({
      signature: "abcd1234", title: "Reservas", fileName: "r.xlsx", fileHash: "h1", columns: ["Data", "Cliente"], rows, rowCount: rows.length,
      dateFrom: "2026-10-01", dateTo: "2026-10-09", importedBy: u.id, applied: { agendamentos: 120 },
    }).returning();
    await db.insert(avecReports).values({ signature: "ffff0000", title: "Clientes", fileName: "c.xlsx", fileHash: "h2", columns: ["Nome"], rows: [["X"]], rowCount: 1, importedAt: new Date(Date.UTC(2026, 0, 1)) });
    const list = await listAvecReports();
    expect(list.map((r) => [r.title, r.rowCount, r.importedByName])).toEqual([["Reservas", 120, "Gestora"], ["Clientes", 1, null]]);
    expect(list[0]).not.toHaveProperty("rows");
    const p2 = await getAvecReport(rep.id, { page: 2 });
    expect(p2).toMatchObject({ total: 120, page: 2, pageSize: 50, pages: 3, columns: ["Data", "Cliente"], applied: { agendamentos: 120 } });
    expect(p2!.rows[0]).toEqual(["06/10/2026", "Cliente 50"]);
    const found = await getAvecReport(rep.id, { q: "conceicao" });
    expect(found).toMatchObject({ total: 1, pages: 1, rows: [["08/10/2026", "Conceição Teste"]] });
    expect((await getAvecReport(rep.id, { page: 99 }))!.page).toBe(3);
    expect(await getAvecReport("nao-e-uuid")).toBeNull();
    const table = await getAvecReportTable(rep.id);
    expect(table?.rows).toHaveLength(120);
  });
});
