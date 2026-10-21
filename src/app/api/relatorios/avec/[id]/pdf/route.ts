import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { can, canSeeAvecReports } from "@/lib/permissions";
import { getAvecReportTable } from "@/server/queries/avec";
import { renderPagePdf } from "@/server/reports/pdf";
import { UserFacingError } from "@/server/domain/errors";
import { contentDisposition, reportFileName } from "@/components/relatorios-avec/format";

export const maxDuration = 90;

/** "Baixar PDF" de um relatório do Avec: o Chromium do servidor imprime /imprimir/avec (paisagem), como quem pediu. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!canSeeAvecReports(user.perms) || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar", { status: 403 });
  const { id } = await ctx.params;
  const t = await getAvecReportTable(id);
  if (!t) return new Response("relatório não encontrado", { status: 404 });
  try {
    const pdf = await renderPagePdf({ path: "/imprimir/avec", params: { id }, userId: user.id, landscape: true });
    return new Response(new Uint8Array(pdf), {
      headers: { "content-type": "application/pdf", "content-disposition": contentDisposition(reportFileName(t.title, t.dateFrom, t.dateTo, "pdf")), "cache-control": "no-store" },
    });
  } catch (e) {
    if (e instanceof UserFacingError) return new Response(e.message, { status: 503 });
    console.error("[pdf avec]", e);
    return new Response("Não deu para gerar o PDF. Tente de novo.", { status: 500 });
  }
}
