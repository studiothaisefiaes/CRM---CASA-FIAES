import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../db";
import { appointments, lists, professionals, professionalServices, users } from "../db/schema";
import { resetDb } from "../../../test/db";
import { resolvePro, type ProContext } from "./pro";
import { getProEarnings, getProReceipt, getProReceipts } from "./pro-earnings";
import { payCommission, undoPayout } from "../domain/caixa/payouts";

const bahia = (day: string, hm: string) => new Date(`${day}T${hm}:00-03:00`);
const NOW = bahia("2026-10-16", "18:00");
let maiara: ProContext;
let biaId = "", gestora = "", corte = "", escova = "";
let n = 0;

const comanda = async (day: string, o: { status?: "aberta" | "fechada" | "cancelada"; client?: string } = {}) => {
  const id = randomUUID();
  const status = o.status ?? "fechada";
  await db.execute(sql`insert into comandas (id, day, number, status, client_name, opened_by, closed_at, cancelled_at)
    values (${id}, ${day}::date, ${++n}, ${status}, ${o.client ?? "Paula Souza"}, ${gestora},
      ${status === "aberta" ? null : bahia(day, "17:00").toISOString()}::timestamptz, ${status === "cancelada" ? bahia(day, "17:30").toISOString() : null}::timestamptz)`);
  return id;
};
// Como o fechamento do 6C congela: a base vem sempre (total menos a parte do desconto); sem regra, só a % e a comissão ficam vazias.
const item = (comandaId: string, o: { pro: string; label: string; total: number; bp: number | null; appointmentId?: string }) =>
  db.execute(sql`insert into comanda_items (comanda_id, kind, label, professional_id, qty, unit_cents, total_cents, commission_bp, commission_base_cents, commission_cents, appointment_id)
    values (${comandaId}, 'servico', ${o.label}, ${o.pro}, 1, ${o.total}, ${o.total}, ${o.bp}, ${o.total}, ${o.bp == null ? null : Math.round((o.total * o.bp) / 10000)}, ${o.appointmentId ?? null})`);

beforeEach(async () => {
  await resetDb();
  gestora = (await db.insert(users).values({ name: "Thaíse", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning())[0].id;
  [corte, escova] = (await db.insert(lists).values([{ kind: "service", label: "Corte (ganhos)", priceCents: 18000 }, { kind: "service", label: "Escova (ganhos)", priceCents: 5000 }]).returning()).map((r) => r.id);
  const [u] = await db.insert(users).values({ name: "Maiara Lima", email: "m@c.com", role: "atendente", passwordHash: "x" }).returning();
  const [p] = await db.insert(professionals).values({ name: "MAIARA", userId: u.id }).returning();
  biaId = (await db.insert(professionals).values({ name: "BIA" }).returning())[0].id;
  maiara = (await resolvePro(u.id))!;
  await db.insert(professionalServices).values([{ professionalId: p.id, serviceId: corte }, { professionalId: p.id, serviceId: escova }]);
  await db.execute(sql`update professional_services set commission_bp = 4000 where professional_id = ${p.id} and service_id = ${corte}`);
});

describe("ganhos da profissional (seção 8.4.7)", () => {
  it("só as linhas dela, de comandas fechadas e não canceladas; hoje e o mês, com o total da comissão", async () => {
    const c1 = await comanda("2026-10-16");
    await item(c1, { pro: maiara.professionalId, label: "Corte", total: 18000, bp: 4000 });
    await item(c1, { pro: biaId, label: "Corte", total: 10000, bp: 4000 });
    await item(await comanda("2026-10-16", { status: "aberta" }), { pro: maiara.professionalId, label: "Corte", total: 18000, bp: 4000 });
    await item(await comanda("2026-10-16", { status: "cancelada" }), { pro: maiara.professionalId, label: "Corte", total: 18000, bp: 4000 });
    await item(await comanda("2026-10-02", { client: "Rita Lima" }), { pro: maiara.professionalId, label: "Corte", total: 10000, bp: 4000 });
    await item(await comanda("2026-09-30"), { pro: maiara.professionalId, label: "Corte", total: 10000, bp: 4000 });
    const g = (await getProEarnings(maiara, NOW, { showServiceValue: false }))!;
    expect(g.configured).toBe(true);
    expect(g.today).toEqual({ totalCents: 7200, lines: [expect.objectContaining({ client: "Paula", label: "Corte", pct: "40%", commissionCents: 7200, serviceCents: null, why: null })] });
    expect(g.month.totalCents).toBe(11200);
    expect(g.month.lines.map((l) => [l.day, l.client])).toEqual([["2026-10-16", "Paula"], ["2026-10-02", "Rita"]]);
  });

  it("o valor do serviço só aparece com 'Mostrar o valor'; sem regra, a linha explica", async () => {
    const c1 = await comanda("2026-10-16");
    await item(c1, { pro: maiara.professionalId, label: "Corte", total: 18000, bp: 4000 });
    await item(c1, { pro: maiara.professionalId, label: "Escova", total: 5000, bp: null });
    const g = (await getProEarnings(maiara, NOW, { showServiceValue: true }))!;
    expect(g.today.lines.map((l) => [l.label, l.serviceCents, l.commissionCents, l.why])).toEqual([
      ["Corte", 18000, 7200, null],
      ["Escova", 5000, null, "Comissão ainda não configurada para Escova. Fale com a gestão."],
    ]);
    expect(g.today.totalCents).toBe(7200);
  });

  it("sem nenhuma regra de comissão dela: configured = false", async () => {
    await db.execute(sql`update professional_services set commission_bp = null where professional_id = ${maiara.professionalId}`);
    expect((await getProEarnings(maiara, NOW, { showServiceValue: false }))!.configured).toBe(false);
  });

  it("horário finalizado e ainda não pago aparece como aguardando fechamento", async () => {
    const [a] = await db.insert(appointments).values({ clientName: "Paula Souza", professionalId: maiara.professionalId, serviceLabel: "Corte", startsAt: bahia("2026-10-16", "10:00"),
      status: "compareceu", finishedAt: bahia("2026-10-16", "11:00"), origin: "crm", externalKey: "t:1" }).returning();
    await db.insert(appointments).values({ clientName: "Avec Antiga", professionalId: maiara.professionalId, serviceLabel: "Corte", startsAt: bahia("2026-10-03", "10:00"),
      status: "compareceu", origin: "avec", externalKey: "t:2" }); // veio do Avec, sem "finalizado no CRM": não conta
    await db.insert(appointments).values({ clientName: "Avec Paga", professionalId: maiara.professionalId, serviceLabel: "Corte", startsAt: bahia("2026-10-16", "09:00"),
      status: "compareceu", finishedAt: bahia("2026-10-16", "12:00"), origin: "avec", externalKey: "t:3" }); // baixa do Avec com a hora da importação (Fase B): também não conta
    expect((await getProEarnings(maiara, NOW, { showServiceValue: false }))!.waiting).toEqual([{ id: a.id, day: "2026-10-16", client: "Paula", service: "Corte" }]);
    await item(await comanda("2026-10-16"), { pro: maiara.professionalId, label: "Corte", total: 18000, bp: 4000, appointmentId: a.id });
    expect((await getProEarnings(maiara, NOW, { showServiceValue: false }))!.waiting).toEqual([]);
  });

  it("recibos: só os dela e não desfeitos; o recibo de outra profissional não abre (Fase A, Tarefa 9)", async () => {
    const c1 = await comanda("2026-10-02");
    await item(c1, { pro: maiara.professionalId, label: "Corte", total: 10000, bp: 4000 });
    await item(c1, { pro: biaId, label: "Corte", total: 10000, bp: 4000 });
    const actor = { id: gestora, perms: [] };
    const mine = await payCommission({ professionalId: maiara.professionalId, until: "2026-10-10", expectedNetCents: 4000 }, actor, NOW);
    const other = await payCommission({ professionalId: biaId, until: "2026-10-10", expectedNetCents: 4000 }, actor, NOW);
    expect((await getProEarnings(maiara, NOW, { showServiceValue: false })).receipts).toEqual([{ id: mine.id, number: 1, paidAt: NOW.toISOString(), netCents: 4000 }]);
    // A página lê os recibos à parte dos ganhos: aparecem mesmo com o caixa no Avec.
    await db.execute(sql`insert into settings (key, value) values ('caixa_modo', '"avec"'::jsonb) on conflict (key) do update set value = excluded.value`);
    expect(await getProReceipts(maiara)).toEqual([{ id: mine.id, number: 1, paidAt: NOW.toISOString(), netCents: 4000 }]);
    expect(await getProReceipt(maiara, mine.id)).toMatchObject({ number: 1, totals: { netCents: 4000 } });
    expect(await getProReceipt(maiara, other.id)).toBeNull();
    expect(await getProReceipt(maiara, "nao-e-um-id")).toBeNull();
    await undoPayout(mine.id, { reason: "errado" }, actor, NOW);
    expect((await getProEarnings(maiara, NOW, { showServiceValue: false })).receipts).toEqual([]);
  });
});
