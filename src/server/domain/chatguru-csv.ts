import { parseCsv } from "./import";
import { forbiddenColumns } from "./avec/sanitize";
import { normalizePhone } from "./phone";
import { TAG_MAX } from "./tags";
import { UserFacingError } from "./errors";

export type ChatguruCsvKind = "chats" | "funil" | "anotacoes";
export type ChatguruCsvRow = {
  line: number; phone: string; name: string | null; link: string | null; since: string | null; tags: string[];
  stage: string | null; responsavel: string | null; note: { at: string | null; author: string | null; text: string } | null;
};
export type ChatguruCsvParse = { kind: ChatguruCsvKind; rows: ChatguruCsvRow[]; total: number; invalid: { line: number; value: string }[]; ignoredColumns: string[]; removedColumns: string[] };

/** CSV do ChatGuru em UTF-8; se vier quebrado (salvo no Excel do Windows), lê como Windows-1252. */
export function decodeCsv(buf: Uint8Array | ArrayBuffer): string {
  const utf = new TextDecoder("utf-8").decode(buf);
  return utf.includes("�") ? new TextDecoder("windows-1252").decode(buf) : utf;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
/** Sinônimos dos cabeçalhos (as colunas do Funil e das anotações não são documentadas: a prévia mostra o que sobrar). Ordem = prioridade. */
const ALIASES: [key: string, names: string[]][] = [
  ["phone", ["whatsapp", "celular", "numero", "telefone", "numero do whatsapp", "numero do contato", "phone"]],
  ["noteText", ["anotacao", "anotacoes", "anotacao interna", "nota", "texto da anotacao"]],
  ["noteAuthor", ["autor", "autor da anotacao", "criado por", "usuario"]],
  ["noteAt", ["data", "data da anotacao", "data hora", "criada em"]],
  ["name", ["nome", "nome do chat", "nome do contato", "chat", "cliente", "contato"]],
  ["link", ["link", "link do chat", "url", "link chat"]],
  ["since", ["data de cadastro", "cadastro", "cadastrado em", "data cadastro", "criado em", "data de criacao"]],
  ["tags", ["tags", "tag", "etiquetas", "etiqueta"]],
  ["stage", ["etapa", "etapa do funil", "coluna", "fase"]],
  ["responsavel", ["responsavel", "responsaveis", "usuario responsavel", "delegado", "delegado para", "atendente"]],
];

const clean = (s: string | undefined) => s?.trim().replace(/\s+/g, " ") || null;
function isoDate(s: string | undefined): string | null {
  const t = s?.trim() ?? "";
  const br = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}
/** "12/10/2026 14:30" (Salvador) ou ISO → instante ISO. */
function noteInstant(s: string | undefined): string | null {
  const t = s?.trim() ?? "";
  const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?/);
  const d = m ? new Date(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}:00-03:00`) : t ? new Date(t) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

/**
 * Lê um CSV exportado do ChatGuru (Relatório de Chats, Funil ou um CSV de anotações), guiado pelo cabeçalho.
 * Colunas de dados pessoais (CPF, RG, endereço, banco) saem ANTES de ler qualquer linha e nunca chegam ao resultado.
 */
export function parseChatguruCsv(text: string): ChatguruCsvParse {
  const all = parseCsv(text);
  if (all.length === 0) throw new UserFacingError("O arquivo está vazio.");
  const header = all[0].map((h) => h.trim());
  const removed = new Set(forbiddenColumns(header));
  const used = new Set<number>();
  const col: Record<string, number> = {};
  for (const [key, names] of ALIASES) {
    const i = header.findIndex((h, idx) => !removed.has(idx) && !used.has(idx) && names.includes(norm(h)));
    if (i >= 0) { col[key] = i; used.add(i); }
  }
  if (col.phone === undefined) throw new UserFacingError("Não achei a coluna do WhatsApp (número) no arquivo. Confira se é o CSV exportado do ChatGuru.");
  const kind: ChatguruCsvKind = col.noteText !== undefined ? "anotacoes" : col.stage !== undefined ? "funil" : "chats";
  const cell = (r: string[], key: string) => (col[key] === undefined ? undefined : r[col[key]]);
  const rows: ChatguruCsvRow[] = [];
  const invalid: { line: number; value: string }[] = [];
  all.slice(1).forEach((r, i) => {
    const line = i + 2;
    const raw = cell(r, "phone")?.trim() ?? "";
    const phone = normalizePhone(raw);
    if (!phone) { invalid.push({ line, value: raw }); return; }
    const text = clean(cell(r, "noteText"));
    if (kind === "anotacoes" && !text) { invalid.push({ line, value: "anotação vazia" }); return; }
    rows.push({
      line, phone, name: clean(cell(r, "name"))?.slice(0, 120) ?? null, link: clean(cell(r, "link")), since: isoDate(cell(r, "since")),
      tags: (cell(r, "tags") ?? "").split(/[,;|]/).map((t) => t.trim()).filter((t) => t && t.length <= TAG_MAX),
      stage: clean(cell(r, "stage")), responsavel: clean(cell(r, "responsavel")),
      note: kind === "anotacoes" ? { at: noteInstant(cell(r, "noteAt")), author: clean(cell(r, "noteAuthor")), text: text! } : null,
    });
  });
  return {
    kind, rows, total: all.length - 1, invalid,
    ignoredColumns: header.filter((_, i) => !used.has(i) && !removed.has(i) && header[i]),
    removedColumns: header.filter((_, i) => removed.has(i)),
  };
}
