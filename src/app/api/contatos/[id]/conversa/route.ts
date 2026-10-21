import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { findSessionUser } from "@/server/auth/sessions-store";
import { exportConversationText, logConversationPdf } from "@/server/domain/conversation-export";
import { renderPagePdf } from "@/server/reports/pdf";
import { UserFacingError } from "@/server/domain/errors";

export const maxDuration = 90;

/** "Exportar conversa" da ficha (LGPD): texto ou PDF; notas internas só com `notas=1`. Precisa ver Contatos e poder exportar. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "contatos.ver") || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const notes = req.nextUrl.searchParams.get("notas") === "1";
  if (req.nextUrl.searchParams.get("formato") === "pdf") {
    const log = await logConversationPdf(id, user, notes);
    if (!log) return new Response("não encontrado", { status: 404 });
    try {
      const pdf = await renderPagePdf({ path: "/imprimir/conversa", params: { contato: id, ...(notes ? { notas: "1" } : {}) }, userId: user.id });
      return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${log.filename}"`, "cache-control": "no-store" } });
    } catch (e) {
      if (e instanceof UserFacingError) return new Response(e.message, { status: 503 });
      console.error("[conversa pdf]", e);
      return new Response("Não deu para gerar o PDF. Tente de novo.", { status: 500 });
    }
  }
  const out = await exportConversationText(id, { id: user.id, name: user.name }, { notes });
  if (!out) return new Response("não encontrado", { status: 404 });
  return new Response(out.body, { headers: { "content-type": "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" } });
}
