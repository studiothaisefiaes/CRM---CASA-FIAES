import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { findSessionUser } from "@/server/auth/sessions-store";
import { contactsCsv, exportContactRows } from "@/server/queries/contacts-csv";
import { csvDisposition } from "@/server/reports/common";
import { parseContactListParams } from "@/lib/contact-list-params";
import { BULK_MAX } from "@/lib/bulk-limits";
import { isUuid } from "@/lib/uuid";

/** Exportar CSV da lista de Contatos (com os filtros da tela) ou só das selecionadas (`ids`). Revalida a sessão a cada pedido. */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "contatos.ver") || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para exportar contatos", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const ids = (sp.get("ids") ?? "").split(",").filter(isUuid).slice(0, BULK_MAX);
  const money = can(user.perms, "valores.ver");
  const rows = await exportContactRows({ ...parseContactListParams(sp), ...(ids.length ? { ids } : {}) }, money);
  return new Response(contactsCsv(rows, { money }), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": csvDisposition("contatos", ids.length ? "selecionados" : "lista"), "Cache-Control": "no-store" },
  });
}
