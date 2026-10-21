import { beforeEach, describe, expect, it } from "vitest";
import { eq, isNull } from "drizzle-orm";
import { db } from "../db";
import { auditLog, clientPackages, lists, packageDefs } from "../db/schema";
import { resetDb } from "../../../test/db";
import { applyAvecPackages, loadAvecPackageInput, packageTitle, parseAvecCatalog, planAvecPackages, type AvecPackageRow } from "./pacotes-avec";

const SVC = [{ id: "s-man", label: "Manutenção Método Fiaes" }, { id: "s-ses", label: "Sessão de pacote metodo" }, { id: "s-fin", label: "Finalização Metodo Fiaes" }, { id: "s-rit", label: "Ritual de Tratamento" }];
let n = 0;
const row = (o: Partial<AvecPackageRow> & { packageName: string }): AvecPackageRow =>
  ({ id: `r${++n}`, contactKey: "c1", serviceLabel: null, totalSessions: 4, priceCents: null, purchasedOn: "2026-09-01", validUntil: "2026-11-30", packageDefId: null, ...o });

describe("packageTitle (nome legível)", () => {
  it("tira o grito das maiúsculas, recoloca acentos conhecidos e separa número de palavra", () => {
    expect(packageTitle("DUAS SESSOES MANUTENCAO METODO FIAES")).toBe("Duas sessões manutenção Método Fiaes");
    expect(packageTitle("Combo 4Escova")).toBe("Combo 4 Escova");
    expect(packageTitle("Combo Ritual  8 Sessões")).toBe("Combo Ritual 8 Sessões");
    expect(packageTitle("Combo Manutenção Método Fiaes")).toBe("Combo Manutenção Método Fiaes");
  });
});

describe("planAvecPackages", () => {
  it("um pacote por nome do Avec: serviços da venda mais comum, sessões, preço mais frequente (empate: o mais recente) e validade mediana", () => {
    const rows = [
      // Combo Manutenção: 3 vendas Sessão + Finalização, 1 venda só Manutenção (outra composição).
      ...["c1", "c2", "c3"].flatMap((c, i) => ["Sessão de pacote metodo", "Finalização  Metodo Fiaes"].map((s) =>
        row({ packageName: "Combo Manutenção Método Fiaes", contactKey: c, serviceLabel: s, priceCents: 800_000, purchasedOn: `2026-09-1${i}`, validUntil: `2027-09-1${i}` }))),
      row({ packageName: "Combo Manutenção Método Fiaes", contactKey: "c4", serviceLabel: "Manutenção Método Fiaes", priceCents: 800_000, purchasedOn: "2026-07-29", validUntil: "2027-07-29" }),
      // Ritual: 143.200 uma vez, 155.200 duas vezes → 155.200; validade 89, 90, 90 → 90.
      row({ packageName: "Combo Ritual 4 Sessões", contactKey: "c5", serviceLabel: "Ritual de Tratamento", priceCents: 143_200, purchasedOn: "2026-07-30", validUntil: "2026-10-28" }),
      row({ packageName: "Combo Ritual 4 Sessões", contactKey: "c6", serviceLabel: "Ritual de Tratamento", priceCents: 155_200, purchasedOn: "2026-08-28", validUntil: "2026-11-26" }),
      row({ packageName: "Combo Ritual 4 Sessões", contactKey: "c7", serviceLabel: "Ritual de Tratamento", priceCents: 155_200, purchasedOn: "2026-09-01", validUntil: "2026-11-30" }),
    ];
    const plan = planAvecPackages({ rows, catalog: [], defs: [], services: SVC });
    expect(plan.criar.map((c) => [c.name, c.priceCents, c.validityDays, c.items.map((i) => [i.serviceId, i.sessions])])).toEqual([
      ["Combo Manutenção Método Fiaes", 800_000, 365, [["s-ses", 4], ["s-fin", 4]]],
      ["Combo Ritual 4 Sessões", 155_200, 90, [["s-rit", 4]]],
    ]);
    expect(plan.criar[0].vendas).toBe(4);
    expect(plan.ligar.map((l) => [l.avecName, l.rowIds.length])).toEqual([["Combo Manutenção Método Fiaes", 7], ["Combo Ritual 4 Sessões", 3]]);
    expect(plan.completar).toEqual([]);
  });

  it("o catálogo do Avec manda no nome, preço, descrição, serviços e sessões; preço diferente das vendas vira aviso; pacote sem venda entra pelo catálogo", () => {
    const rows = [row({ packageName: "DUAS SESSOES MANUTENCAO METODO FIAES", serviceLabel: "Manutenção Método Fiaes", totalSessions: 1, priceCents: 400_000, purchasedOn: "2026-09-09", validUntil: "2026-12-08" }),
      row({ packageName: "Combo Ritual 4 Sessões", serviceLabel: "Ritual de Tratamento", priceCents: 155_200 })];
    const catalog = parseAvecCatalog({ pacotes: [
      { avec: "DUAS SESSOES MANUTENCAO METODO FIAES", nome: "Duas sessões de manutenção Método Fiaes", precoCents: 400_000, itens: [{ servico: "Manutenção Método Fiaes", sessoes: 2, unitCents: 200_000 }] },
      { avec: "Combo Ritual 4 Sessões", precoCents: 143_200, descricao: "Ganha 4 finalizações." },
      { avec: "Combo Ritual  8 Sessões", nome: "Combo Ritual 8 Sessões", precoCents: 286_400, itens: [{ servico: "Ritual de Tratamento", sessoes: 8 }] },
      { avec: "Combo Sem Serviço", precoCents: 100 },
    ] });
    const plan = planAvecPackages({ rows, catalog, defs: [], services: SVC });
    const by = Object.fromEntries(plan.criar.map((c) => [c.name, c]));
    expect(by["Duas sessões de manutenção Método Fiaes"]).toMatchObject({ priceCents: 400_000, validityDays: 90, items: [{ serviceId: "s-man", sessions: 2, unitCents: 200_000 }], vendas: 1 });
    expect(by["Combo Ritual 4 Sessões"]).toMatchObject({ priceCents: 143_200, description: "Ganha 4 finalizações." });
    expect(by["Combo Ritual 8 Sessões"]).toMatchObject({ priceCents: 286_400, validityDays: null, vendas: 0, items: [{ serviceId: "s-rit", sessions: 8, unitCents: null }] });
    expect(by["Combo Sem Serviço"]).toBeUndefined();
    expect(plan.avisos).toEqual(expect.arrayContaining([
      expect.stringMatching(/Combo Ritual 4 Sessões: preço do catálogo R\$\s?1\.432,00; nas vendas R\$\s?1\.552,00/),
      expect.stringMatching(/Duas sessões de manutenção Método Fiaes: sessões do catálogo \(2\) ≠ das vendas \(1\)/),
      expect.stringMatching(/Combo Sem Serviço: sem serviço/),
    ]));
  });

  it("idempotente: pacote já existente (pelo nome do Avec, mesmo renomeado) só completa o vazio; preço diferente fica como divergência; liga só quem está sem pacote", () => {
    const rows = [row({ packageName: "Combo Alinhamento", serviceLabel: "Ritual de Tratamento", priceCents: 280_000, packageDefId: null }),
      row({ packageName: "Combo Alinhamento", contactKey: "c2", serviceLabel: "Ritual de Tratamento", priceCents: 280_000, packageDefId: "d1" }),
      row({ packageName: "Combo Alinhamento", contactKey: "c3", serviceLabel: "Ritual de Tratamento", priceCents: 280_000, packageDefId: "outro" })];
    const defs = [{ id: "d1", name: "Alinhamento (combo)", avecName: "Combo Alinhamento", priceCents: 250_000, validityDays: null, description: null, items: [{ serviceId: "s-rit", sessions: 4, unitCents: null }], active: true }];
    const plan = planAvecPackages({ rows, catalog: [], defs, services: SVC });
    expect(plan.criar).toEqual([]);
    expect(plan.completar).toEqual([{ id: "d1", name: "Alinhamento (combo)", set: { validityDays: 90 } }]);
    expect(plan.divergencias).toEqual([{ name: "Alinhamento (combo)", campo: "preço", crm: 250_000, avec: 280_000 }]);
    expect(plan.ligar).toEqual([{ avecName: "Combo Alinhamento", defId: "d1", rowIds: [rows[0].id] }]);
    // Sem nome do Avec gravado, acha pelo nome (e grava o nome do Avec).
    const p2 = planAvecPackages({ rows, catalog: [], defs: [{ ...defs[0], name: "combo alinhamento", avecName: null, validityDays: 90 }], services: SVC });
    expect(p2.completar).toEqual([{ id: "d1", name: "combo alinhamento", set: { avecName: "Combo Alinhamento" } }]);
  });
});

describe("applyAvecPackages (banco)", () => {
  beforeEach(resetDb);

  it("cria, liga as vendas do Avec sem mudar mais nada, grava backup e auditoria; rodar de novo não muda nada", async () => {
    const [svc] = await db.insert(lists).values({ kind: "service", label: "Ritual de Tratamento", position: 1 }).returning();
    const base = { packageName: "Combo Ritual 4 Sessões", serviceLabel: "Ritual de Tratamento", totalSessions: 4, usedSessions: 1, priceCents: 155_200, origin: "avec" };
    await db.insert(clientPackages).values([
      { ...base, clientName: "Fulana", purchasedOn: "2026-09-01", validUntil: "2026-11-30", externalKey: "k1" },
      { ...base, clientName: "Beltrana", purchasedOn: "2026-10-03", validUntil: "2027-01-01", externalKey: "k2" },
    ]);
    const before = await db.select().from(clientPackages).orderBy(clientPackages.externalKey);
    const backups: unknown[] = [];
    const plan = planAvecPackages(await loadAvecPackageInput([]));
    expect(plan.criar).toHaveLength(1);
    const r = await applyAvecPackages(plan, async (b) => { backups.push(b); });
    expect(r).toEqual({ criados: 1, completados: 0, ligados: 2 });
    const [def] = await db.select().from(packageDefs);
    expect(def).toMatchObject({ name: "Combo Ritual 4 Sessões", avecName: "Combo Ritual 4 Sessões", priceCents: 155_200, validityDays: 90, items: [{ serviceId: svc.id, sessions: 4, unitCents: null }], active: true });
    const after = await db.select().from(clientPackages).orderBy(clientPackages.externalKey);
    expect(after.map((a) => a.packageDefId)).toEqual([def.id, def.id]);
    expect(after.map(({ packageDefId: _, ...a }) => a)).toEqual(before.map(({ packageDefId: _, ...a }) => a)); // nada além do package_def_id
    expect(backups).toEqual([expect.objectContaining({ defsAntes: [], ligados: before.map((b) => b.id).sort() })]);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "importou"))).toHaveLength(1);

    const again = planAvecPackages(await loadAvecPackageInput([]));
    expect([again.criar.length, again.completar.length, again.ligar.length]).toEqual([0, 0, 0]);
    expect(await db.select().from(clientPackages).where(isNull(clientPackages.packageDefId))).toHaveLength(0);
  });
});
