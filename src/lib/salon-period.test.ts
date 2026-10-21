import { describe, expect, it } from "vitest";
import { bucketLabel, rangeLabel, salonBuckets, salonQuery, salonRange, todayBahia } from "./salon-period";

const NOW = new Date("2026-10-15T15:00:00Z"); // quinta, 12h em Salvador

describe("período do Salão", () => {
  it("hoje é o dia de Salvador, também depois das 21h (quando em UTC já é amanhã)", () => {
    expect(todayBahia(new Date("2026-10-16T01:30:00Z"))).toBe("2026-10-15");
    expect(salonRange({ periodo: "hoje" }, NOW)).toMatchObject({ preset: "hoje", from: "2026-10-15", to: "2026-10-15", prevFrom: "2026-10-14", prevTo: "2026-10-14", days: 1, grain: "dia" });
  });
  it("7 dias, este mês, mês passado e este ano, cada um com o período anterior certo", () => {
    expect(salonRange({ periodo: "7d" }, NOW)).toMatchObject({ from: "2026-10-09", to: "2026-10-15", prevFrom: "2026-10-02", prevTo: "2026-10-08" });
    expect(salonRange({ periodo: "mes" }, NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-15", prevFrom: "2026-09-01", prevTo: "2026-09-15", grain: "dia" });
    expect(salonRange({ periodo: "mes-passado" }, NOW)).toMatchObject({ from: "2026-09-01", to: "2026-09-30", prevFrom: "2026-08-01", prevTo: "2026-08-31" });
    expect(salonRange({ periodo: "ano" }, NOW)).toMatchObject({ from: "2026-01-01", to: "2026-10-15", prevFrom: "2025-01-01", prevTo: "2025-10-15", grain: "mes" });
  });
  it("31 de março: o pedaço do mês anterior para no último dia de fevereiro; em janeiro, o mês passado é dezembro", () => {
    expect(salonRange({ periodo: "mes" }, new Date("2026-03-31T15:00:00Z"))).toMatchObject({ prevFrom: "2026-02-01", prevTo: "2026-02-28" });
    expect(salonRange({ periodo: "mes-passado" }, new Date("2026-01-10T15:00:00Z"))).toMatchObject({ from: "2025-12-01", to: "2025-12-31", prevFrom: "2025-11-01", prevTo: "2025-11-30" });
  });
  it("período livre: compara com os mesmos dias logo antes", () => {
    expect(salonRange({ de: "2026-09-10", ate: "2026-09-20" }, NOW)).toMatchObject({
      preset: "livre", from: "2026-09-10", to: "2026-09-20", prevFrom: "2026-08-30", prevTo: "2026-09-09", days: 11, label: "10/09 a 20/09/2026",
    });
  });
  it("período livre torto: invertido, dia que não existe, ano 4676 e mais de 3 anos são corrigidos sem erro", () => {
    expect(salonRange({ de: "2026-09-20", ate: "2026-09-10" }, NOW)).toMatchObject({ from: "2026-09-10", to: "2026-09-20" });
    expect(salonRange({ de: "2026-02-30", ate: "lixo" }, NOW)).toMatchObject({ preset: "mes", from: "2026-10-01", to: "2026-10-15" });
    const absurdo = salonRange({ de: "4676-11-10" }, NOW);
    expect(absurdo.from).toBe("2026-10-15");
    expect(absurdo.to <= "2027-10-16").toBe(true);
    const longo = salonRange({ de: "2010-01-01", ate: "2026-10-15" }, NOW);
    expect(longo.from >= "2015-01-01").toBe(true);
    expect(longo.days).toBeLessThanOrEqual(1098);
  });
  it("barras: uma por dia até 62 dias, uma por mês acima disso, sem buracos", () => {
    expect(salonBuckets({ from: "2026-09-28", to: "2026-10-02", grain: "dia" })).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]);
    expect(salonBuckets({ from: "2025-11-15", to: "2026-02-03", grain: "mes" })).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(bucketLabel("2026-09-28")).toBe("28/09");
    expect(rangeLabel("2025-12-30", "2026-01-02")).toBe("30/12/2025 a 02/01/2026");
  });
  it("a URL do período volta ao mesmo período", () => {
    expect(salonQuery(salonRange({ periodo: "mes-passado" }, NOW))).toBe("aba=salao&periodo=mes-passado");
    expect(salonQuery(salonRange({ de: "2026-09-10", ate: "2026-09-20" }, NOW))).toBe("aba=salao&de=2026-09-10&ate=2026-09-20");
  });
  it("a mesma URL serve ao Financeiro (plano 4)", () => {
    expect(salonQuery({ preset: "7d", from: "2026-10-09", to: "2026-10-15" }, "financeiro")).toBe("aba=financeiro&periodo=7d");
    expect(salonQuery({ preset: "livre", from: "2026-09-01", to: "2026-09-30" }, "financeiro")).toBe("aba=financeiro&de=2026-09-01&ate=2026-09-30");
  });
});
