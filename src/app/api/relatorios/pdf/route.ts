import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { can } from "@/lib/permissions";
import { renderPdf, type PdfTipo } from "@/server/reports/pdf";
import { UserFacingError } from "@/server/domain/errors";

export const maxDuration = 90;

/** "Baixar PDF" dos Relatórios: do período escolhido ou por atendente. O conteúdo respeita as permissões de quem baixa. */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const tipo: PdfTipo = sp.get("tipo") === "equipe" ? "equipe" : "periodo";
  const periodo = ["hoje", "7d", "mes", "ano"].includes(sp.get("periodo") ?? "") ? sp.get("periodo")! : "mes";
  try {
    const pdf = await renderPdf({ tipo, periodo, userId: user.id });
    const name = `casa-fiaes-${tipo === "equipe" ? "equipe" : "relatorio"}-${periodo}-${new Date().toISOString().slice(0, 10)}.pdf`;
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof UserFacingError) return new Response(e.message, { status: 503 });
    console.error("[pdf]", e);
    return new Response("Não deu para gerar o PDF. Tente de novo.", { status: 500 });
  }
}
