import { describe, expect, it } from "vitest";
import { PRINCIPAIS, organizeAvecReports, sectionOf, type AvecReportLite } from "./avec-catalog";

let seq = 0;
const r = (title: string, o: Partial<AvecReportLite> = {}): AvecReportLite => ({
  id: `r${++seq}`, title, rowCount: 10, dateFrom: "2026-01-01", dateTo: "2026-10-14", importedAt: "2026-10-14T12:00:00Z", applied: {}, ...o,
});

describe("Relatórios do Avec organizados", () => {
  it("os 11 principais viram cartões na ordem, mesmo os que ainda não vieram, e não se repetem nas seções", () => {
    const c = organizeAvecReports([r("Reservas", { applied: { agendamentos: 120 } }), r("Itens de comanda")]);
    expect(c.principais.map((p) => p.title)).toEqual([...PRINCIPAIS]);
    expect(c.principais.find((p) => p.title === "Reservas")!.type).toMatchObject({ applied: true });
    expect(c.principais.find((p) => p.title === "Aniversariantes")!.type).toBeNull();
    expect(c.secoes.flatMap((s) => s.types.map((t) => t.title))).toEqual(["Itens de comanda"]);
  });

  it("seções por assunto, na ordem combinada", () => {
    expect(sectionOf("Bloqueios de agenda")).toBe("agenda");
    expect(sectionOf("Itens de comanda")).toBe("vendas");
    expect(sectionOf("Comissão por item")).toBe("profissionais");
    expect(sectionOf("Taxas de cartão")).toBe("financeiro");
    expect(sectionOf("Clientes por bairro")).toBe("clientes");
    expect(sectionOf("Estoque de produtos")).toBe("produtos");
    expect(sectionOf("Notas fiscais (NFC-e)")).toBe("notas");
    expect(sectionOf("Uso de pacotes")).toBe("pacotes");
    expect(sectionOf("Relatório: A, B, C")).toBe("outros");
    const c = organizeAvecReports([r("Taxas de cartão"), r("Bloqueios de agenda"), r("Itens de comanda")]);
    expect(c.secoes.map((s) => s.key)).toEqual(["agenda", "vendas", "financeiro"]);
  });

  it("vazios no fim; repetidos (mesmas linhas e mesmo período, no mesmo assunto) juntados no primeiro", () => {
    const c = organizeAvecReports([
      r("Lucratividade por produto", { rowCount: 504 }), r("Lucro por produto", { rowCount: 504, applied: { itensVenda: 1 } }), r("Produtos (códigos)", { rowCount: 30 }),
      r("Cheques", { rowCount: 0 }),
    ]);
    const produtos = c.secoes.find((s) => s.key === "produtos")!;
    expect(produtos.types.map((t) => [t.title, t.also.map((a) => a.title), t.applied])).toEqual([
      ["Lucratividade por produto", ["Lucro por produto"], true], ["Produtos (códigos)", [], false],
    ]);
    expect(c.vazios.map((t) => t.title)).toEqual(["Cheques"]);
  });

  it("o último envio do tipo é o de período mais novo (empate: o enviado por último)", () => {
    const old = r("Reservas", { dateTo: "2026-09-30" }), novo = r("Reservas", { dateTo: "2026-10-14" });
    expect(organizeAvecReports([old, novo]).principais.find((p) => p.title === "Reservas")!.type!.latest.id).toBe(novo.id);
  });
});
