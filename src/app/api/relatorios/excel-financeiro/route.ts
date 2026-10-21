import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { salonRange } from "@/lib/salon-period";
import { getFinanceiroConfig } from "@/server/domain/financeiro/config";
import { listExpenses } from "@/server/domain/financeiro/despesas";
import { assertCanSeeResultado, loadResultado } from "@/server/reports/financeiro/resultado";
import { findSessionUser } from "@/server/auth/sessions-store";
import { financeSales, loadFinanceiro } from "@/server/reports/financeiro";
import { avecItems, crmItems } from "@/server/reports/financeiro/itens";
import { buildFinanceiroXlsx, financeiroFileName } from "@/server/reports/financeiro/xlsx";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Relatórios › Financeiro › "Baixar Excel": o mesmo período da tela (`periodo` ou `de`/`ate`). Gestão com valores e exportação. */
export async function GET(req: NextRequest) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "relatorios.ver") || !can(user.perms, "valores.ver") || !can(user.perms, "relatorios.exportar")) return new Response("sem permissão para o Financeiro", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const range = salonRange({ periodo: sp.get("periodo"), de: sp.get("de"), ate: sp.get("ate") }, new Date());
  // Despesas e Resultado só entram com a função ligada em Configurações › Financeiro; o Resultado também confere `valores.ver`.
  const cfg = await getFinanceiroConfig();
  if (cfg.resultado) assertCanSeeResultado(user.perms);
  const now = new Date();
  const [view, sales, crm, avec, expenses, resultado] = await Promise.all([loadFinanceiro(range), financeSales(range), crmItems(range), avecItems(range),
    cfg.contasAPagar ? listExpenses({ from: range.from, to: range.to }, now) : Promise.resolve(null), cfg.resultado ? loadResultado(range, now) : Promise.resolve(null)]);
  const buf = await buildFinanceiroXlsx(view, { sales, items: [...crm, ...avec], geradoPor: user.name, geradoEm: now, expenses, resultado });
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": XLSX, "content-disposition": `attachment; filename="${financeiroFileName(range)}"`, "cache-control": "no-store" },
  });
}
