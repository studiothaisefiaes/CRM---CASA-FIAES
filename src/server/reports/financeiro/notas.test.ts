import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { comandaItems, fiscalDocuments, professionals } from "@/server/db/schema";
import { resetDb } from "../../../../test/db";
import { setupCaixa } from "../../../../test/caixa-fixtures";
import { comanda } from "../../../../test/financeiro-fixtures";
import { salonRange } from "@/lib/salon-period";
import { hasNotas, loadNotas, notasFiscaisOn } from "./notas";
import { settings } from "@/server/db/schema";

let s: Awaited<ReturnType<typeof setupCaixa>>;
const R = () => salonRange({ de: "2026-10-01", ate: "2026-10-31" }, new Date("2026-10-18T12:00:00Z"));
beforeEach(async () => {
  await resetDb(); s = await setupCaixa();
  await db.update(professionals).set({ bond: "parceira", cnpj: "11222333000181", legalName: "ANA SILVA ME" }).where(eq(professionals.id, s.ana.id));
});
const comParceira = async (day: string, cents: number, status: "fechada" | "cancelada" = "fechada") => {
  const c = await comanda({ day, by: s.cati.id, status, items: [{ label: "Corte", unitCents: 10000, professionalId: s.ana.id, netCents: 10000, commissionCents: cents }] });
  await db.update(comandaItems).set({ partnerCnpj: "11222333000181" }).where(eq(comandaItems.comandaId, c.id));
  return c;
};

describe("Notas fiscais", () => {
  it("extrato da parceira: soma do mês, sem comanda cancelada, fora do período fica de fora", async () => {
    await comParceira("2026-10-05", 4000); await comParceira("2026-10-20", 2500); await comParceira("2026-10-21", 9999, "cancelada"); await comParceira("2026-09-30", 7000);
    const { parceiras } = await loadNotas(R());
    expect(parceiras).toEqual([{ professionalId: s.ana.id, name: "Ana", legalName: "ANA SILVA ME", cnpj: "11222333000181", month: "2026-10", cents: 6500, comandas: 2 }]);
  });
  it("notas do período com comanda, dia, tipo, ambiente e situação", async () => {
    const c = await comParceira("2026-10-05", 4000);
    const fora = await comParceira("2026-09-05", 1000);
    await db.insert(fiscalDocuments).values([
      { comandaId: c.id, kind: "nfse", environment: "teste", series: 1, number: 1, localId: "D1", status: "rejeitada", amountCents: 10000, rejectReason: "E160" },
      { comandaId: fora.id, kind: "nfse", environment: "teste", series: 1, number: 2, localId: "D2", status: "autorizada", amountCents: 10000 },
    ]);
    const { notas } = await loadNotas(R());
    expect(notas).toEqual([{ id: expect.any(String), comandaNumber: c.number, day: "2026-10-05", kind: "nfse", environment: "teste", status: "rejeitada", amountCents: 10000, accessKey: null, rejectReason: "E160" }]);
    expect(await hasNotas(R())).toBe(true);
    expect(await hasNotas(salonRange({ de: "2026-08-01", ate: "2026-08-31" }, new Date("2026-10-18T12:00:00Z")))).toBe(false);
  });
  it("a aba Notas fiscais aparece com a NFS-e OU a NFC-e ligada, ou com alguma nota no período (M-1)", async () => {
    const set = (key: string, value: string) => db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
    expect(await notasFiscaisOn(R())).toBe(false);
    await set("nfce_modo", "teste");
    expect(await notasFiscaisOn(R())).toBe(true);
    await set("nfce_modo", "desligada"); await set("nfse_modo", "producao");
    expect(await notasFiscaisOn(R())).toBe(true);
  });
});
