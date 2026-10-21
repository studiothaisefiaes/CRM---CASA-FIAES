import { normHeader } from "./normalize";

/**
 * Dados pessoais que NUNCA ficam guardados (nem na tabela crua do relatório): documentos, endereço e dados bancários.
 * Por nome normalizado do cabeçalho; "Número" só sai quando é o do endereço (ao lado de Endereço/CEP/Complemento/Bairro),
 * porque em outros relatórios "Número" é o da comanda.
 */
const FORBIDDEN = new Set(["cpf", "rg", "cep", "endereco", "complemento", "bairro", "cidade", "estado", "banco", "agencia", "conta"]);
const ADDRESS = new Set(["endereco", "cep", "complemento", "bairro"]);
/** Palavras que, em qualquer parte do cabeçalho, marcam dado pessoal ("CPF/CNPJ", "RG / Órgão", "Número de endereço", "Chave Pix"…). */
const FORBIDDEN_WORDS = new Set(["cpf", "rg", "cep", "endereco", "logradouro", "complemento", "bairro", "cidade", "municipio", "uf", "banco", "agencia", "conta", "pix"]);
const words = (c: string) => c.split(/[^a-z0-9]+/).filter(Boolean);
/** "Conta Bancária" dos relatórios financeiros é a conta da própria Casa que recebeu (não é dado de pessoa): fica. */
const ALLOWED = new Set(["conta bancaria"]);

/** Índices das colunas proibidas. */
export function forbiddenColumns(header: string[]): number[] {
  const h = header.map(normHeader);
  return h.flatMap((c, i) => {
    if (ALLOWED.has(c)) return [];
    if (FORBIDDEN.has(c) || words(c).some((w) => FORBIDDEN_WORDS.has(w))) return [i];
    if (c === "numero" && (ADDRESS.has(h[i - 1] ?? "") || ADDRESS.has(h[i + 1] ?? ""))) return [i];
    return [];
  });
}

/** Tabela sem as colunas proibidas (e o nome das que saíram, para conferência). */
export function sanitizeTable(header: string[], rows: string[][]): { columns: string[]; rows: string[][]; removed: string[] } {
  const drop = new Set(forbiddenColumns(header));
  const keep = header.map((_, i) => i).filter((i) => !drop.has(i));
  return {
    columns: keep.map((i) => header[i]),
    rows: rows.map((r) => keep.map((i) => r[i] ?? "")),
    removed: [...drop].sort((a, b) => a - b).map((i) => header[i]),
  };
}
