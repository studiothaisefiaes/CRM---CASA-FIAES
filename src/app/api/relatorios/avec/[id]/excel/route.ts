import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { can, canSeeAvecReports } from "@/lib/permissions";
import { getAvecReportTable } from "@/server/queries/avec";
import { buildXlsx } from "@/server/domain/avec/xlsx";
import { contentDisposition, reportFileName } from "@/components/relatorios-avec/format";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** "Baixar Excel" de um relatório do Avec guardado: a tabela saneada (sem CPF, RG, endereço, banco), tudo como texto. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!canSeeAvecReports(user.perms) || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar", { status: 403 });
  const { id } = await ctx.params;
  const t = await getAvecReportTable(id);
  if (!t) return new Response("relatório não encontrado", { status: 404 });
  // Nome de aba do Excel: até 31 caracteres e sem [ ] : * ? / \
  const sheet = t.title.replace(/[[\]:*?/\\]+/g, " ").trim();
  const buf = await buildXlsx([t.columns, ...t.rows], sheet);
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": XLSX, "content-disposition": contentDisposition(reportFileName(t.title, t.dateFrom, t.dateTo, "xlsx")), "cache-control": "no-store" },
  });
}
