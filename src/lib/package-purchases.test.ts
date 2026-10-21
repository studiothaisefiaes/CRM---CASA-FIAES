import { describe, expect, it } from "vitest";
import { groupPackagePurchases, serviceTitle, servicesLine, type PackageRowLike } from "./package-purchases";

let n = 0;
const row = (o: Partial<PackageRowLike>): PackageRowLike => ({
  id: `r${++n}`, contactId: "c1", clientName: "Ana", packageName: "Combo Manutenção Método Fiaes", serviceLabel: null,
  totalSessions: 4, usedSessions: 0, priceCents: 800000, purchasedOn: "2025-12-09", validUntil: "2026-12-09", ...o,
});

describe("groupPackagePurchases", () => {
  it("as 4 linhas do mesmo combo (um serviço cada) viram UMA compra: preço uma vez, sessões = maior total, usadas = maior used", () => {
    const rows = [
      row({ serviceLabel: "Finalização Metodo Fiaes", usedSessions: 1 }),
      row({ serviceLabel: "Confeção Metodo Fiaes", usedSessions: 2 }),
      row({ serviceLabel: "Meia Aplicação Metodo Fiaes", usedSessions: 3 }),
      row({ serviceLabel: "Confecção Cabelo Metodo Fiaes", usedSessions: 1 }),
    ];
    const [p, ...rest] = groupPackagePurchases(rows);
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({ id: rows[0].id, packageName: "Combo Manutenção Método Fiaes", priceCents: 800000, purchasedOn: "2025-12-09", validUntil: "2026-12-09", usedSessions: 3, totalSessions: 4 });
    expect(p.rowIds).toEqual(rows.map((r) => r.id));
    expect(p.services.map((s) => [s.label, s.usedSessions, s.totalSessions])).toEqual([
      ["Confeção Método Fiaes", 2, 4], ["Confecção Cabelo Método Fiaes", 1, 4], ["Finalização Método Fiaes", 1, 4], ["Meia Aplicação Método Fiaes", 3, 4],
    ]);
  });

  it("2 linhas da mesma compra (nome com caixa/espaço diferente) viram uma; o uso de cada serviço aparece na linha", () => {
    const rows = [
      row({ contactId: "c2", packageName: "COMBO MANUTENÇÃO  MÉTODO FIAES", serviceLabel: "Sessão de pacote metodo" }),
      row({ contactId: "c2", packageName: "Combo Manutenção Método Fiaes", serviceLabel: "Finalização Metodo Fiaes" }),
    ];
    const out = groupPackagePurchases(rows);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ usedSessions: 0, totalSessions: 4 });
    expect(servicesLine(out[0])).toBe("Finalização Método Fiaes 0 de 4 · Sessão de Pacote Método 0 de 4");
  });

  it("pacotes diferentes de verdade continuam separados: outro nome, outra data de compra, outro preço, outra validade, outra cliente", () => {
    const base = row({ serviceLabel: "Finalização Metodo Fiaes" });
    const rows = [
      base,
      row({ serviceLabel: "Confeção Metodo Fiaes" }), // mesma compra que a base
      row({ packageName: "Hidratação 10x", serviceLabel: "Hidratação", totalSessions: 10, priceCents: 50000 }),
      row({ purchasedOn: "2026-03-01", validUntil: "2027-03-01", serviceLabel: "Finalização Metodo Fiaes" }),
      row({ priceCents: 700000, serviceLabel: "Finalização Metodo Fiaes" }),
      row({ validUntil: "2027-01-10", serviceLabel: "Finalização Metodo Fiaes" }),
      row({ contactId: "c9", serviceLabel: "Finalização Metodo Fiaes" }),
    ];
    const out = groupPackagePurchases(rows);
    expect(out).toHaveLength(6);
    expect(out[0].rowIds).toEqual([rows[0].id, rows[1].id]);
    expect(out.slice(1).every((p) => p.rowIds.length === 1)).toBe(true);
  });

  it("sem data de compra não junta (não dá para saber se é a mesma venda); sem contato junta pelo nome da cliente; mantém a ordem de chegada", () => {
    const rows = [
      row({ contactId: null, clientName: "MARIA  silva", serviceLabel: "A" }),
      row({ purchasedOn: null, serviceLabel: "B" }),
      row({ purchasedOn: null, serviceLabel: "C" }),
      row({ contactId: null, clientName: "Maria Silva", serviceLabel: "D" }),
    ];
    const out = groupPackagePurchases(rows);
    expect(out.map((p) => p.rowIds)).toEqual([[rows[0].id, rows[3].id], [rows[1].id], [rows[2].id]]);
  });

  it("linha única: o serviço igual ao nome do pacote não se repete na linha de serviços", () => {
    const [p] = groupPackagePurchases([row({ packageName: "Escova 4x", serviceLabel: "ESCOVA 4X", totalSessions: 4, usedSessions: 2 })]);
    expect(p.services).toHaveLength(1);
    expect(servicesLine(p)).toBeNull();
    const [q] = groupPackagePurchases([row({ packageName: "Combo", serviceLabel: "escova modelada", usedSessions: 2 })]);
    expect(servicesLine(q)).toBe("Escova Modelada");
  });
});

describe("serviceTitle", () => {
  it("Título com partículas minúsculas e os acentos que o Avec perdeu", () => {
    expect(serviceTitle("Sessão de pacote metodo")).toBe("Sessão de Pacote Método");
    expect(serviceTitle("FINALIZAÇÃO METODO FIAES")).toBe("Finalização Método Fiaes");
    expect(serviceTitle("  meia   aplicação do cabelo e  manutencao ")).toBe("Meia Aplicação do Cabelo e Manutenção");
  });
});
