/** Prazo de cada comando no banco (ms). Padrão 60 s: a consulta mais longa do dia é a visão por contato (~10 s). 0 desliga. */
export function dbStatementTimeoutMs(e: Record<string, string | undefined> = process.env): number {
  const n = Number(e.DB_STATEMENT_TIMEOUT_MS ?? "");
  return e.DB_STATEMENT_TIMEOUT_MS != null && e.DB_STATEMENT_TIMEOUT_MS !== "" && Number.isFinite(n) && n >= 0 ? n : 60_000;
}
