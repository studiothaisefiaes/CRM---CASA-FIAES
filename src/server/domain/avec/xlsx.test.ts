import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { buildXlsx, cellText, readXlsx } from "./xlsx";

describe("xlsx (Avec)", () => {
  it("lê a 1ª planilha como texto: telefone e comanda número viram dígitos, dinheiro vira número em reais", async () => {
    const buf = await buildXlsx([
      ["Data", "Comanda", "Cliente", "Celular", "Valor", "Hora", "Extra"],
      ["01/10/2026", 1234, "Rita (T. USO DE IMAGEM)", 71990000001, 150, "09:30", ""],
      ["", "", "", "", "", "", ""],
      ["02/10/2026", 1235, "Sol", null, 89.9, "14:00", "x"],
    ]);
    const rows = await readXlsx(buf);
    expect(rows).toEqual([
      ["Data", "Comanda", "Cliente", "Celular", "Valor", "Hora", "Extra"],
      ["01/10/2026", "1234", "Rita (T. USO DE IMAGEM)", "71990000001", "150", "09:30", ""],
      ["02/10/2026", "1235", "Sol", "", "89.9", "14:00", "x"],
    ]);
  });

  it("ignora colunas vazias depois do cabeçalho", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("A");
    ws.addRow(["Nome", "Celular"]);
    ws.addRow(["Rita", "71999990001", "", "lixo"]);
    const rows = await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(rows).toEqual([["Nome", "Celular"], ["Rita", "71999990001"]]);
  });

  it("célula de data/hora do Excel vira dd/mm/aaaa ou HH:MM", () => {
    expect(cellText(new Date(Date.UTC(2026, 9, 1)))).toBe("01/10/2026");
    expect(cellText(new Date(Date.UTC(2026, 9, 1, 10, 28)))).toBe("01/10/2026 10:28");
    expect(cellText(new Date(Date.UTC(1899, 11, 30, 9, 30)))).toBe("09:30");
    expect(cellText({ richText: [{ text: "Ri" }, { text: "ta" }] })).toBe("Rita");
    expect(cellText({ formula: "A1", result: 10 } as ExcelJS.CellValue)).toBe("10");
  });
});

describe("xlsx do jeito que o Avec exporta", () => {
  /** O Avec grava as linhas SEM o número (<row> sem r) e as células com texto embutido (inlineStr): o exceljs recusa ("Invalid row number"). */
  async function avecLike(rowsXml: string, extra: Record<string, string> = {}) {
    const JSZip = (await import("jszip")).default;
    const z = new JSZip();
    z.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    z.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    z.file("xl/workbook.xml", `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Planilha" sheetId="1" r:id="rId1"/></sheets></workbook>`);
    z.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`);
    z.file("xl/worksheets/sheet1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\t<sheetData>\t\t${rowsXml}</sheetData></worksheet>`);
    for (const [k, v] of Object.entries(extra)) z.file(k, v);
    return z.generateAsync({ type: "uint8array" });
  }
  const s = (t: string) => `<c t='inlineStr'><is><t>${t}</t></is></c>`;

  it("lê linhas sem número, texto embutido, número e caracteres especiais", async () => {
    const buf = await avecLike(
      `<row>${s("Data Reserva")}${s("Hora")}${s("Cliente")}${s("Celular")}${s("Valor")}</row>` +
      `<row>${s("01/10/2026")}${s("10:00")}${s("Ana &amp; Bia (T. USO DE IMAGEM)")}<c><v>71990000001</v></c><c><v>150.5</v></c></row>` +
      `<row>${s("")}${s("")}${s("")}${s("")}${s("")}</row>` +
      `<row>${s("02/10/2026")}${s("14:30")}${s("Sol")}${s("")}<c><v>80</v></c></row>`);
    expect(await readXlsx(buf)).toEqual([
      ["Data Reserva", "Hora", "Cliente", "Celular", "Valor"],
      ["01/10/2026", "10:00", "Ana & Bia (T. USO DE IMAGEM)", "71990000001", "150.5"],
      ["02/10/2026", "14:30", "Sol", "", "80"],
    ]);
  });

  it("textos compartilhados (sharedStrings) e células com posição (r) pulando colunas", async () => {
    const buf = await avecLike(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>3</v></c><c r="C2"><v>7</v></c></row>`,
      { "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Nome</t></si><si><t>Celular</t></si><si><r><t>Vi</t></r><r><t>sitas</t></r></si><si><t xml:space="preserve">Rita </t></si></sst>` });
    expect(await readXlsx(buf)).toEqual([["Nome", "Celular", "Visitas"], ["Rita", "", "7"]]);
  });
});
