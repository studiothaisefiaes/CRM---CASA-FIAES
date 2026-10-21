import { describe, expect, it } from "vitest";
import { brDate, checkUpload, contentDisposition, funnelLine, groupReports, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES, periodLabel, reportFileName, summaryLines } from "./format";
import { emptySummary } from "@/server/domain/avec/context";

describe("relatórios do Avec: textos da tela", () => {
  it("data e período em dd/mm/aaaa", () => {
    expect(brDate("2026-10-01")).toBe("01/10/2026");
    expect(brDate(null)).toBe("");
    expect(periodLabel(null, null)).toBe("Sem data");
    expect(periodLabel("2026-10-01", "2026-10-01")).toBe("01/10/2026");
    expect(periodLabel("2026-10-01", "2026-10-14")).toBe("01/10 a 14/10/2026");
    expect(periodLabel("2025-12-03", "2026-10-14")).toBe("03/12/2025 a 14/10/2026");
  });

  it("nome do arquivo legível, sem caracteres que o Windows recusa", () => {
    expect(reportFileName("Reservas", "2026-10-01", "2026-10-14", "xlsx")).toBe("Avec - Reservas - 01-10 a 14-10-2026.xlsx");
    expect(reportFileName("Itens: comanda/pacote", null, null, "pdf")).toBe("Avec - Itens comanda pacote.pdf");
  });

  it("content-disposition com nome em ASCII e o original em UTF-8", () => {
    const cd = contentDisposition("Avec - Comissões - 01-10-2026.xlsx");
    expect(cd).toBe(`attachment; filename="Avec - Comissoes - 01-10-2026.xlsx"; filename*=UTF-8''${encodeURIComponent("Avec - Comissões - 01-10-2026.xlsx")}`);
  });

  it("agrupa por tipo (ordem alfabética) e, dentro, o período mais novo primeiro", () => {
    const r = (id: string, title: string, dateTo: string | null, importedAt = "2026-10-14T10:00:00Z") => ({ id, title, dateTo, importedAt });
    const groups = groupReports([r("1", "Reservas", "2026-10-14"), r("2", "Clientes", null), r("3", "Reservas", "2026-12-19"), r("4", "Reservas", null, "2026-10-15T10:00:00Z")]);
    expect(groups.map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([["Clientes", ["2"]], ["Reservas", ["3", "1", "4"]]]);
  });

  it("resumo só com o que entrou, em palavras simples", () => {
    expect(summaryLines(emptySummary())).toEqual([]);
    expect(summaryLines({ ...emptySummary(), contatosNovos: 3, agendamentos: 1, itensVenda: 12 })).toEqual([
      { key: "contatosNovos", n: 3, label: "clientes novas" },
      { key: "agendamentos", n: 1, label: "horário na agenda" },
      { key: "itensVenda", n: 12, label: "itens vendidos" },
    ]);
  });

  it("limites do envio: só .xlsx, quantidade e tamanho", () => {
    const f = (name: string, size = 1000) => ({ name, size });
    expect(checkUpload([])).toBe("Escolha pelo menos um arquivo .xlsx.");
    expect(checkUpload([f("a.xlsx"), f("B.XLSX")])).toBeNull();
    expect(checkUpload([f("a.csv")])).toBe("“a.csv” não é .xlsx. Exporte do Avec em Excel (.xlsx).");
    expect(checkUpload(Array.from({ length: MAX_FILES + 1 }, (_, i) => f(`${i}.xlsx`)))).toMatch(/^No máximo \d+ arquivos/);
    expect(checkUpload([f("grande.xlsx", MAX_FILE_BYTES + 1)])).toMatch(/^“grande.xlsx” passa de \d+ MB/);
    const n = Math.ceil(MAX_TOTAL_BYTES / MAX_FILE_BYTES) + 1;
    expect(checkUpload(Array.from({ length: n }, (_, i) => f(`${i}.xlsx`, MAX_FILE_BYTES)))).toMatch(/^Os arquivos juntos passam de \d+ MB/);
  });

  it("funnelLine: o que a importação mudou no funil, em uma frase", () => {
    expect(funnelLine(null)).toBeNull();
    expect(funnelLine({ agendados: 0, datasAtualizadas: 0, naCasa: 0, atendidas: 0, aguardando: 0, cartoesNovos: 0, erros: [] })).toBeNull();
    expect(funnelLine({ agendados: 2, datasAtualizadas: 1, naCasa: 0, atendidas: 1, aguardando: 0, cartoesNovos: 1, erros: [] }))
      .toBe("Nas etapas: 2 foram para Agendado, 1 teve a data do horário atualizada, 1 foi para Atendida, 1 cartão novo em Agendado.");
    expect(funnelLine({ agendados: 0, datasAtualizadas: 0, naCasa: 2, atendidas: 0, aguardando: 0, cartoesNovos: 0, erros: [] })).toBe("Nas etapas: 2 foram para Na Casa.");
  });
});
