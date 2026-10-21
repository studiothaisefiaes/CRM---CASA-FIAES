import { rolesOf, type AvecRole } from "../formats";

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Texto visível de uma célula da tabela do Avec (que pode vir com HTML). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]*>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") { const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return ENT[e.toLowerCase()] ?? m;
    }).replace(/\s+/g, " ").trim();
}

export class AvecLayoutError extends Error {}

/**
 * Monta a tabela (cabeçalho + linhas) como o .xlsx do Avec. Confere o layout: se o número de colunas das linhas não bate com o cabeçalho
 * ou o formato deixou de ser o esperado, o Avec mudou a tela e o robô para esse relatório (nada é importado errado).
 */
export function buildTable(code: string, expect: AvecRole, headers: string[], aaData: unknown): string[][] {
  const head = headers.map(cellText);
  if (!head.length || head.every((h) => !h)) throw new AvecLayoutError(`${code}: o Avec não mostrou o cabeçalho do relatório.`);
  if (!Array.isArray(aaData)) throw new AvecLayoutError(`${code}: resposta sem a lista de linhas.`);
  if (!rolesOf(head).includes(expect)) throw new AvecLayoutError(`${code}: as colunas mudaram, o CRM não reconhece mais o formato.`);
  const rows = aaData.map((r) => {
    const cells = Array.isArray(r) ? r : r && typeof r === "object" ? Object.values(r) : null;
    if (!cells || cells.length !== head.length) throw new AvecLayoutError(`${code}: uma linha tem ${cells?.length ?? 0} colunas e o cabeçalho tem ${head.length}.`);
    return cells.map(cellText);
  });
  return [head, ...rows];
}
