import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { funnel, responseTimes, origins, objections, finance, toCsv, PERIOD_LABEL, type Period } from "@/server/reports";
import { formatPhone } from "@/server/domain/phone";

const PAY: Record<string, string> = { pix: "Pix", cartao: "Cartão", boleto: "Boleto", dinheiro: "Dinheiro" };
const brl = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));

export async function GET(req: NextRequest, ctx: RouteContext<"/api/relatorios/[tipo]">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const { tipo } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const period = (["hoje", "7d", "mes", "ano"].includes(sp.get("periodo") ?? "") ? sp.get("periodo") : "mes") as Period;
  const f = { period, ownerId: user.role === "gestor" ? sp.get("dono") || null : user.id, origin: sp.get("origem") || null };
  if ((tipo === "financeiro" || tipo === "cobrancas") && user.role !== "gestor") return new Response("só a gestão", { status: 403 });
  let csv: string;
  switch (tipo) {
    case "funil": { const r = await funnel(f); const base = r[0]?.reached || 1; csv = toCsv(["Etapa", "Leads que passaram", "% do total"], r.map((s) => [s.name, s.reached, Math.round((s.reached / base) * 100)])); break; }
    case "resposta": { const r = await responseTimes(f); csv = toCsv(["Pessoa", "Respostas", "Tempo médio (s)", "Mediana (s)", "Dentro da meta", "Meta (s)", "Alertas de atraso"], r.map((x) => [x.name, x.responses, x.avgSeconds, x.medianSeconds, x.withinGoal, x.goalSeconds, x.alerts])); break; }
    case "origem": { const r = await origins(f); csv = toCsv(["Origem", "Leads", "Fechados", "Receita (R$)"], r.map((x) => [x.origin, x.leads, x.won, brl(Number(x.revenueCents))])); break; }
    case "objecoes": { const r = await objections(f); csv = toCsv(["Tipo", "Motivo", "Quantidade"], [...r.objections.map((x) => ["Objeção", x.label, x.n]), ...r.lostReasons.map((x) => ["Motivo de perda", x.label, x.n])]); break; }
    case "financeiro": { const r = await finance(f); csv = toCsv(["Forma de pagamento", "Vendas", "Total (R$)"], [...r.byMethod.map((x) => [x.method ? PAY[x.method] ?? x.method : "Não informado", x.n, brl(Number(x.totalCents))]), ["Total", r.deals, brl(r.totalCents)], ["Ticket médio", "", brl(r.ticketCents)]]); break; }
    case "cobrancas": { const r = await finance(f); csv = toCsv(["Cliente", "Telefone", "Data de cobrança", "Valor (R$)"], r.upcoming.map((x) => [x.name ?? "", formatPhone(x.phone), new Date(x.chargeAt).toLocaleString("pt-BR", { timeZone: "America/Bahia" }), brl(x.valueCents)])); break; }
    default: return new Response("relatório desconhecido", { status: 404 });
  }
  const name = `casa-fiaes-${tipo}-${PERIOD_LABEL[period].toLowerCase().replace(/\s+/g, "-")}.csv`;
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
