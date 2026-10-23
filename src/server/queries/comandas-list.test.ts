import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db";
import { comandas, contacts } from "../db/schema";
import { eq } from "drizzle-orm";
import { resetDb } from "../../../test/db";
import { cliente, NOW } from "../../../test/agenda-fixtures";
import { setupCaixa } from "../../../test/caixa-fixtures";
import { comandaFechada } from "../../../test/comanda-fixtures";
import { openWalkInComanda } from "../domain/caixa/comandas";
import { setItemAssistants } from "../domain/caixa/assistants";
import { getComandaDetail } from "./caixa";
import { clientComandas, listComandas } from "./comandas-list";

let s: Awaited<ReturnType<typeof setupCaixa>>;
beforeEach(async () => { await resetDb(); s = await setupCaixa({ estoque: false }); });
const pix = (v: number) => ({ method: "pix" as const, valueCents: v });
const nums = (r: { rows: { number: number; day: string }[] }) => r.rows.map((x) => `${x.day}#${x.number}`);
const TODAY = "2026-10-15";

describe("listComandas: o histórico de comandas (22/10, como 'Comandas finalizadas' do Avec)", () => {
  it("período, situação, profissional (principal ou assistente) e busca por cliente, telefone ou número; mais nova primeiro", async () => {
    const paula = await cliente("Paula Souza");
    await comandaFechada(s, { day: "2026-10-10", contactId: paula.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [pix(12000)] });
    await comandaFechada(s, { day: "2026-10-12", items: [{ serviceId: s.corte.id, professionalId: s.bia.id }], pays: [pix(2000)], contactId: (await cliente("Lia Reis")).contactId, leaveDebt: true });
    const aberta = await openWalkInComanda({ clientName: "Balcão", requestKey: randomUUID(), item: { kind: "servico", serviceId: s.corte.id, professionalId: s.bia.id } }, s.caixaRecepcao, NOW);
    const [item] = (await getComandaDetail(aberta.comandaId, s.cati.id))!.items;
    await setItemAssistants(item.id, { professionalIds: [s.ana.id] }, s.caixaRecepcao);

    const all = await listComandas({ from: "2026-10-01", to: TODAY, blind: false }, NOW);
    expect(nums(all)).toEqual([`${TODAY}#1`, "2026-10-12#1", "2026-10-10#1"]);
    expect(all.total).toBe(3);
    expect(nums(await listComandas({ from: "2026-10-11", to: "2026-10-14", blind: false }, NOW))).toEqual(["2026-10-12#1"]);
    expect(nums(await listComandas({ from: "2026-10-01", to: TODAY, status: "aberta", blind: false }, NOW))).toEqual([`${TODAY}#1`]);
    const divida = await listComandas({ from: "2026-10-01", to: TODAY, status: "divida", blind: false }, NOW);
    expect([nums(divida), divida.rows[0].debtCents]).toEqual([["2026-10-12#1"], 10000]);
    // Ana: principal da 10/10 e assistente da de hoje
    expect(nums(await listComandas({ from: "2026-10-01", to: TODAY, professionalId: s.ana.id, blind: false }, NOW))).toEqual([`${TODAY}#1`, "2026-10-10#1"]);
    expect(nums(await listComandas({ from: "2026-10-01", to: TODAY, q: "paula", blind: false }, NOW))).toEqual(["2026-10-10#1"]);
    const [ph] = await db.select({ p: contacts.phoneE164 }).from(contacts).where(eq(contacts.id, paula.contactId));
    expect(nums(await listComandas({ from: "2026-10-01", to: TODAY, q: ph.p.slice(-6), blind: false }, NOW))).toEqual(["2026-10-10#1"]);
    expect(nums(await listComandas({ from: "2026-10-01", to: TODAY, q: "1", blind: false }, NOW)).length).toBe(3); // nº 1 nos três dias
    const row = all.rows.find((r) => r.day === TODAY)!;
    expect(row.professionals.sort()).toEqual(["Ana", "Bia"]);
  });

  it("no máximo 200 linhas, com o total real", async () => {
    const values = Array.from({ length: 205 }, (_, k) => ({ day: "2026-10-14", number: k + 1, clientName: `C${k}`, status: "cancelada" as const, requestKey: randomUUID(), openedBy: s.cati.id, openedAt: NOW, updatedAt: NOW }));
    await db.insert(comandas).values(values);
    const r = await listComandas({ from: "2026-10-14", to: "2026-10-14", blind: false }, NOW);
    expect([r.rows.length, r.total]).toEqual([200, 205]);
  });

  it("contagem cega: sem o valor das pagas HOJE; as de outros dias continuam com valor", async () => {
    await comandaFechada(s, { items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [pix(12000)] });
    await comandaFechada(s, { day: "2026-10-10", items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [pix(12000)] });
    const r = await listComandas({ from: "2026-10-01", to: TODAY, blind: true }, NOW);
    expect(r.rows.map((x) => [x.day, x.totalCents, x.paidCents])).toEqual([[TODAY, null, null], ["2026-10-10", 12000, 12000]]);
  });
});

describe("clientComandas: as comandas na ficha da cliente", () => {
  it("só as dela, mais nova primeiro, com limite", async () => {
    const paula = await cliente("Paula Souza");
    const lia = await cliente("Lia Reis");
    await comandaFechada(s, { day: "2026-10-10", contactId: paula.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [pix(12000)] });
    await comandaFechada(s, { day: "2026-10-12", contactId: paula.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [pix(12000)] });
    await comandaFechada(s, { day: "2026-10-12", contactId: lia.contactId, items: [{ serviceId: s.corte.id, professionalId: s.ana.id }], pays: [pix(12000)] });
    expect((await clientComandas(paula.contactId)).map((r) => r.day)).toEqual(["2026-10-12", "2026-10-10"]);
    expect((await clientComandas(paula.contactId, 1)).length).toBe(1);
  });
});
