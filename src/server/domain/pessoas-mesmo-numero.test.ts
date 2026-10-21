import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { appointments, clientPackages, contacts, packageUses, users, visits } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyPeoplePlan, loadNameRows, planFromRows, type NameRow, type PeopleBackup } from "./pessoas-mesmo-numero";
import { addPersonToNumber } from "./people-on-number";

const row = (contactId: string, contactName: string | null, clientName: string, n = 1, kind: NameRow["kind"] = "horario"): NameRow => ({ contactId, contactName, avec: true, clientName, kind, n });

describe("planFromRows (só os dados)", () => {
  it("separa a filha; apelido, erro de digitação e nome genérico não viram pessoa; sem nome ou nome que não bate fica a conferir", () => {
    const plan = planFromRows([
      row("m", "Marta Souza", "MARTA SOUZA", 3), row("m", "Marta Souza", "Bruna Souza", 2), row("m", "Marta Souza", "BRUNA", 1, "pacote"), row("m", "Marta Souza", "Cliente", 1),
      row("a", "Ana Lima", "Ana Lima", 2), row("a", "Ana Lima", "Aninha Lima"), row("a", "Ana Lima", "ANA  LIMA"),
      row("z", null, "Carla", 1), row("z", null, "Diana", 1),
      row("w", "Mãezinha 💕", "Rita Lima", 1), row("w", "Mãezinha 💕", "Joana Lima", 1),
      row("p", "Zildney Matos (Liz Matos)", "Zildney Matos"), row("p", "Zildney Matos (Liz Matos)", "Liz Matos", 4),
    ], []);
    expect(plan.casos).toHaveLength(1);
    expect(plan.casos[0]).toMatchObject({ holderId: "m", holderNames: ["MARTA SOUZA"], pessoas: [{ name: "Bruna Souza", names: ["Bruna Souza", "BRUNA"], horarios: 2, pacotes: 1, personId: null }] });
    expect(plan.conferir.map((u) => u.holderId).sort()).toEqual(["w", "z"]);
  });

  it("pessoa que já existe no número é reaproveitada; --pular deixa o número de fora", () => {
    const rows = [row("m", "Marta Souza", "Marta Souza"), row("m", "Marta Souza", "Bruna S.")];
    expect(planFromRows(rows, [{ holderId: "m", id: "f1", name: "Bruna Souza" }]).casos[0].pessoas[0]).toMatchObject({ personId: "f1", name: "Bruna Souza" });
    expect(planFromRows(rows, [], ["m"]).casos).toHaveLength(0);
  });
});

describe("aplicar (banco, dados fictícios)", () => {
  beforeEach(resetDb);

  it("cria a filha e religa os horários dela (com a visita inteira), pacotes e usos; o da mãe e a visita mista ficam; idempotente", async () => {
    const [mae] = await db.insert(contacts).values({ name: "Marta Souza", phoneE164: "+5571988000001" }).returning();
    const [v1, v2] = await db.insert(visits).values([{ contactId: mae.id, day: "2026-10-01", clientName: "Bruna Souza" }, { contactId: mae.id, day: "2026-10-02", clientName: "Marta Souza" }]).returning();
    const base = { serviceLabel: "Corte", status: "agendado", origin: "avec" } as const;
    const [aMae, aFilha, aMista] = await db.insert(appointments).values([
      { ...base, contactId: mae.id, clientName: "Marta Souza", startsAt: new Date("2026-10-02T12:00:00Z"), externalKey: "t1", visitId: v2.id },
      { ...base, contactId: mae.id, clientName: "Bruna Souza", startsAt: new Date("2026-10-01T12:00:00Z"), externalKey: "t2", visitId: v1.id },
      { ...base, contactId: mae.id, clientName: "BRUNA", startsAt: new Date("2026-10-02T13:00:00Z"), externalKey: "t3", visitId: v2.id },
    ]).returning();
    const [pk] = await db.insert(clientPackages).values({ contactId: mae.id, clientName: "Bruna Souza", packageName: "Combo", totalSessions: 4, externalKey: "p1" }).returning();
    const [uso] = await db.insert(packageUses).values({ contactId: mae.id, clientName: "Bruna Souza", usedOn: "2026-10-01", item: "Corte", externalKey: "u1" }).returning();

    const { rows, existing } = await loadNameRows();
    const plan = planFromRows(rows, existing);
    expect(plan.casos.map((c) => [c.holderName, c.pessoas.map((p) => p.name)])).toEqual([["Marta Souza", ["Bruna Souza"]]]);
    const before = await db.select().from(appointments);
    expect(before).toHaveLength(3); // o ensaio não grava nada
    expect(await db.select().from(contacts)).toHaveLength(1);

    let backup: PeopleBackup | null = null;
    const res = await applyPeoplePlan(plan, async (b) => { backup = b; });
    expect(res).toMatchObject({ pessoasNovas: 1, horarios: 2, visitas: 1, pacotes: 1, usos: 1 });
    const [filha] = await db.select().from(contacts).where(eq(contacts.sharesPhoneWith, mae.id));
    expect(filha.name).toBe("Bruna Souza");
    const owner = async (id: string) => (await db.select().from(appointments).where(eq(appointments.id, id)))[0].contactId;
    expect([await owner(aMae.id), await owner(aFilha.id), await owner(aMista.id)]).toEqual([mae.id, filha.id, filha.id]);
    expect((await db.select().from(visits).where(eq(visits.id, v1.id)))[0].contactId).toBe(filha.id);
    expect((await db.select().from(visits).where(eq(visits.id, v2.id)))[0].contactId).toBe(mae.id); // mãe e filha na mesma visita
    expect((await db.select().from(clientPackages).where(eq(clientPackages.id, pk.id)))[0].contactId).toBe(filha.id);
    expect((await db.select().from(packageUses).where(eq(packageUses.id, uso.id)))[0].contactId).toBe(filha.id);
    expect(backup!.casos[0].registros.map((r) => r.tabela).sort()).toEqual(["appointments", "appointments", "client_packages", "package_uses", "visits", "visits"]);

    const again = await loadNameRows();
    expect(planFromRows(again.rows, again.existing).casos).toHaveLength(0);
  });

  it("a filha que já foi adicionada na tela recebe os horários dela", async () => {
    const [mae] = await db.insert(contacts).values({ name: "Marta Souza", phoneE164: "+5571988000002" }).returning();
    const [u] = await db.insert(users).values({ name: "G", email: "g@c.com", role: "gestor", passwordHash: "x" }).returning();
    const { contactId: filha } = await addPersonToNumber({ contactId: mae.id, name: "Bruna Souza" }, u.id);
    await db.insert(appointments).values({ contactId: mae.id, clientName: "Bruna Souza", serviceLabel: "Corte", status: "agendado", origin: "avec", startsAt: new Date(), externalKey: "t9" });
    const { rows, existing } = await loadNameRows();
    const plan = planFromRows([...rows, row(mae.id, "Marta Souza", "Marta Souza")], existing);
    const res = await applyPeoplePlan(plan, async () => {});
    expect(res).toMatchObject({ pessoasNovas: 0, pessoasExistentes: 1, horarios: 1 });
    expect((await db.select().from(appointments))[0].contactId).toBe(filha);
  });
});
