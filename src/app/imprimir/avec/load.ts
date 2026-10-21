import { consumePrintToken } from "@/server/reports/print-token";
import { getAvecReportTable } from "@/server/queries/avec";
import { can, canSeeAvecReports } from "@/lib/permissions";

/** Acima disso o PDF fica pesado demais para o Chromium e para ler: sai o começo e o aviso de usar o Excel. */
export const PRINT_MAX_ROWS = 2000;

/**
 * Dados da página de impressão de um relatório do Avec: usa o token de uso único e exige que a pessoa veja e exporte relatórios.
 * null = não abre (token inválido/vencido/usado, sem permissão ou relatório inexistente).
 */
export async function loadAvecPrint(token: string | null | undefined, id: string | null | undefined) {
  const user = await consumePrintToken(token ?? null);
  if (!user || !canSeeAvecReports(user.perms) || !can(user.perms, "relatorios.exportar") || !id) return null;
  const table = await getAvecReportTable(id);
  if (!table) return null;
  const cut = Math.max(0, table.rows.length - PRINT_MAX_ROWS);
  return { user, table: { ...table, rows: table.rows.slice(0, PRINT_MAX_ROWS) }, total: table.rows.length, cut };
}
