import ExcelJS from "exceljs";
import JSZip from "jszip";

/**
 * Planilhas .xlsx do Avec: lê a 1ª planilha como tabela de texto (linha 1 = cabeçalho) e monta .xlsx a partir de uma tabela
 * (para baixar o relatório saneado e para os testes com planilhas sintéticas).
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** Texto de uma célula como a equipe vê: número sem notação científica, data "dd/mm/aaaa", hora "HH:MM". */
export function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return Number.isInteger(v) ? v.toFixed(0) : String(v);
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const hm = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    if (v.getUTCFullYear() <= 1900) return hm; // só hora (Excel guarda como fração do dia)
    const d = `${pad(v.getUTCDate())}/${pad(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    return hm === "00:00" && v.getUTCSeconds() === 0 ? d : `${d} ${hm}`;
  }
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
    if ("result" in v) return cellText((v.result ?? null) as ExcelJS.CellValue);
    if ("text" in v) return cellText(v.text as ExcelJS.CellValue);
    if ("error" in v) return "";
  }
  return String(v).trim();
}

const ENTITY: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unxml = (t: string) => t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITY[e.toLowerCase()]);
/** Texto de um nó com <t> (célula embutida ou item de sharedStrings): junta todos os pedaços (rich text), sem a pronúncia (<rPh>). */
const textOf = (xml: string) => [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const attr = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1];
const colIndex = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+$/, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

/** Formatos de número que são data/hora (os embutidos do Excel e os personalizados com d/m/a/h). */
const DATE_BUILTIN = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
function dateStyles(stylesXml: string | null): Set<number> {
  const out = new Set<number>();
  if (!stylesXml) return out;
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) custom.set(Number(attr(m[1], "numFmtId")), unxml(attr(m[1], "formatCode") ?? ""));
  const xfs = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
  [...xfs.matchAll(/<xf\b([^>]*?)\/?>/g)].forEach((m, i) => {
    const id = Number(attr(m[1], "numFmtId") ?? 0);
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]/g, "") ?? "";
    if (DATE_BUILTIN.has(id) || /[dmyh]/i.test(code)) out.add(i);
  });
  return out;
}
/** Número de série do Excel (dias desde 30/12/1899) → Date em UTC. */
const serialDate = (n: number) => new Date(Math.round((n - 25569) * 86_400_000));

/**
 * 1ª planilha → linhas de texto. O cabeçalho define a largura; linhas totalmente vazias saem.
 * Lê o XML direto (não o exceljs): o Avec exporta linhas SEM número (<row> sem r) e o exceljs recusa todos os arquivos dele.
 */
export async function readXlsx(data: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  const read = (p: string) => zip.file(p)?.async("string") ?? Promise.resolve(null);
  // A 1ª planilha pela ordem do workbook (o nome do arquivo nem sempre é sheet1.xml).
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wbXml = await read("xl/workbook.xml"), relsXml = await read("xl/_rels/workbook.xml.rels");
  const rid = wbXml?.match(/<sheet\b[^>]*\br:id=["']([^"']+)["']/)?.[1];
  const target = rid && relsXml ? [...relsXml.matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => m[1]).find((a) => attr(a, "Id") === rid) : undefined;
  const t = target ? attr(target, "Target") : undefined;
  if (t) sheetPath = t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`;
  const sheet = (await read(sheetPath)) ?? (await read("xl/worksheets/sheet1.xml"));
  if (!sheet) return [];
  const sstXml = await read("xl/sharedStrings.xml");
  const shared = sstXml ? [...sstXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const dates = dateStyles(await read("xl/styles.xml"));

  const raw: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const out: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1], body = cm[2] ?? "";
      const ref = attr(a, "r");
      const col = ref && /^[A-Z]+\d*$/i.test(ref) ? colIndex(ref) : next;
      next = col + 1;
      const type = attr(a, "t");
      const v = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
      let value: ExcelJS.CellValue = null;
      if (type === "inlineStr") value = textOf(body);
      else if (type === "s") value = v != null ? shared[Number(v)] ?? "" : "";
      else if (type === "str") value = v != null ? unxml(v) : "";
      else if (type === "b") value = v === "1";
      else if (type === "e") value = null;
      else if (v != null && v.trim() !== "") {
        const n = Number(v);
        value = Number.isNaN(n) ? unxml(v) : dates.has(Number(attr(a, "s") ?? -1)) ? serialDate(n) : n;
      }
      out[col] = cellText(value);
    }
    raw.push(Array.from(out, (c) => c ?? ""));
  }
  if (!raw.length) return [];
  const header = raw[0];
  let width = header.length;
  while (width > 0 && !header[width - 1]) width--;
  return raw.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")).filter((r, i) => i === 0 || r.some((c) => c));
}

/** Tabela → .xlsx (1ª linha em negrito). Números ficam número; o resto, texto. */
export async function buildXlsx(rows: (string | number | null | undefined)[][], sheetName = "Relatório"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || "Relatório");
  for (const r of rows) ws.addRow(r.map((c) => (c == null ? "" : c)));
  if (rows.length) ws.getRow(1).font = { bold: true };
  ws.columns.forEach((c) => { c.width = 18; });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
