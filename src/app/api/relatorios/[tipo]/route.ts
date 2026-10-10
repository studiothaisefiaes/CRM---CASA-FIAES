import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { csvDisposition, PERIOD_LABEL, toCsv, type Period, type ReportFilter } from "@/server/reports/common";
import {
  crmVsPhone, dataQuality, demandHeatmap, executiveNumbers, financeWithPaid, firstResponse, followupEfficacy, funnelMilestones,
  lossesByReasonAndStage, personVsGoal, sourceToSale, staleNow, type ChargeItem,
} from "@/server/reports/queries";
import { scopedFilter } from "@/server/reports/screen";
import { MIN_SAMPLE } from "@/lib/report-format";
import { formatPhone } from "@/server/domain/phone";

const PAY: Record<string, string> = { pix: "Pix", cartao: "Cartão", boleto: "Boleto", dinheiro: "Dinheiro" };
const GESTAO_ONLY = new Set(["financeiro", "cobrancas", "pessoas"]);
const brl = (c: number | null | undefined) => (c == null ? "" : (c / 100).toFixed(2).replace(".", ","));
/** % só com amostra suficiente: com menos de 20 casos a célula fica vazia (o n está na planilha). */
const pctCell = (part: number, whole: number) => (whole >= MIN_SAMPLE ? Math.round((100 * part) / whole) : "");
const when = (iso: string | Date) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Bahia" });
const DAYS = [{ i: 1, n: "Segunda" }, { i: 2, n: "Terça" }, { i: 3, n: "Quarta" }, { i: 4, n: "Quinta" }, { i: 5, n: "Sexta" }, { i: 6, n: "Sábado" }, { i: 0, n: "Domingo" }];
const KIND: Record<string, string> = { proxima_acao: "Próxima ação", retorno: "Retorno", comparecimento: "Comparecimento", geral: "Geral" };

export async function GET(req: NextRequest, ctx: RouteContext<"/api/relatorios/[tipo]">) {
  // Revalida a sessão a cada pedido: o CSV não confia na tela que o ofereceu.
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const { tipo } = await ctx.params;
  const gestor = user.role === "gestor";
  if (GESTAO_ONLY.has(tipo) && !gestor) return new Response("só a gestão", { status: 403 });
  const sp = req.nextUrl.searchParams;
  const rawPeriod = ({ semana: "7d" } as Record<string, string>)[sp.get("periodo") ?? ""] ?? sp.get("periodo") ?? "";
  const period = (["hoje", "7d", "mes", "ano"].includes(rawPeriod) ? rawPeriod : "mes") as Period;
  const base: ReportFilter = { period, ownerId: sp.get("dono") || null, source: sp.get("origem") || null };
  const f: ReportFilter = { ...scopedFilter(user, base), compare: tipo === "numeros" };

  let csv: string;
  switch (tipo) {
    case "numeros": {
      const n = await executiveNumbers(f);
      const slaPct = (v: number | null, size: number) => (size >= MIN_SAMPLE ? v : "");
      csv = toCsv(["Indicador", "Período atual", "Período anterior", "n atual", "n anterior"], [
        ["Leads novos", n.leadsNovos.atual, n.leadsNovos.anterior, n.leadsNovos.n, n.leadsNovos.nAnterior],
        ["Primeira resposta no prazo (%)", slaPct(n.pctPrimeiraRespostaNoSla.atual, n.pctPrimeiraRespostaNoSla.n), slaPct(n.pctPrimeiraRespostaNoSla.anterior, n.pctPrimeiraRespostaNoSla.nAnterior), n.pctPrimeiraRespostaNoSla.n, n.pctPrimeiraRespostaNoSla.nAnterior],
        ["Agendamentos marcados", n.agendamentosMarcados.atual, n.agendamentosMarcados.anterior, n.agendamentosMarcados.n, n.agendamentosMarcados.nAnterior],
        ["Vendas (quantidade)", n.vendas.atual.n, n.vendas.anterior.n, n.vendas.atual.n, n.vendas.anterior.n],
        ...(gestor ? [
          ["Vendas (R$)", brl(n.vendas.atual.cents), brl(n.vendas.anterior.cents), n.vendas.atual.n, n.vendas.anterior.n],
          ["Ticket médio (R$)", brl(n.ticketMedio.atual), brl(n.ticketMedio.anterior), n.ticketMedio.n, n.ticketMedio.nAnterior],
        ] : []),
      ]);
      break;
    }
    case "resposta": {
      const r = await firstResponse(f);
      csv = toCsv(["Etapa", "Primeiras respostas (n)", "Mediana (s)", "p90 (s)", "Meta (s)", "Até 2 min", "2 a 10 min", "10 min a 1 h", "Mais de 1 h", "% dentro do prazo"], [
        ["Todas as etapas", r.n, r.p50, r.p90, "", r.bands.ate2, r.bands.de2a10, r.bands.de10a60, r.bands.mais1h, pctCell(r.slaHit, r.n)],
        ...r.byStage.map((s) => [s.name, s.n, s.p50, "", s.slaSeconds, "", "", "", "", s.n >= MIN_SAMPLE ? s.slaHitPct : ""]),
        ["Leads novos sem resposta agora", r.semResposta, "", "", "", "", "", "", "", ""],
      ]);
      break;
    }
    case "funil": {
      const m = await funnelMilestones(f);
      csv = toCsv(["Marco", "Leads", "% dos leads novos"], [
        ["Leads novos", m.leads, ""], ["Respondidos", m.respondidos, pctCell(m.respondidos, m.leads)], ["Agendados", m.agendados, pctCell(m.agendados, m.leads)],
        ["Fechados", m.fechados, pctCell(m.fechados, m.leads)], ["Perdidos (à parte)", m.perdidos, pctCell(m.perdidos, m.leads)], ["Ainda em aberto", m.emAberto, pctCell(m.emAberto, m.leads)],
      ]);
      break;
    }
    case "parados": {
      const r = await staleNow({ ownerId: f.ownerId, source: f.source });
      csv = toCsv(["Etapa", "Leads abertos", "Leads parados", "Mais antigo parado (dias)"], r.map((s) => [s.stage, s.total, s.parados, s.maisAntigoSeg == null ? "" : Math.floor(s.maisAntigoSeg / 86_400)]));
      break;
    }
    case "canal": {
      const c = await crmVsPhone(f);
      csv = toCsv(["Canal da primeira resposta", "Leads", "% do total"], [["Pelo CRM", c.crm, pctCell(c.crm, c.total)], ["Direto pelo celular", c.celular, pctCell(c.celular, c.total)], ["Total (n)", c.total, ""]]);
      break;
    }
    case "origem": {
      const r = await sourceToSale(f);
      csv = toCsv(["Origem", "Leads", "Agendados", "Fechados", "% fechados", ...(gestor ? ["Receita (R$)"] : [])],
        r.map((x) => [x.origem, x.leads, x.agendados, x.fechados, pctCell(x.fechados, x.leads), ...(gestor ? [brl(x.receitaCents)] : [])]));
      break;
    }
    case "objecoes": {
      const l = await lossesByReasonAndStage(f);
      csv = toCsv(["Tipo", "Item", "Etapa de onde saiu", "Quantidade", "Fecharam", "Perderam", "Em aberto"], [
        ...l.matrix.map((x) => ["Perda", x.motivo, x.stage, x.n, "", "", ""]),
        ...l.objections.map((x) => ["Objeção", x.objection, "", x.n, x.fechados, x.perdidos, x.emAberto]),
      ]);
      break;
    }
    case "qualidade": {
      const q = await dataQuality(f);
      csv = toCsv(["Checagem", "Com problema", "Base (de)"], [...q.checks.map((c) => [c.label, c.n, c.of]), ["Índice composto (0 a 100)", q.overallPct ?? "", ""]]);
      break;
    }
    case "followup": {
      const r = await followupEfficacy(f);
      csv = toCsv(["Tipo de tarefa", "Previstas", "Concluídas", "Canceladas", "No prazo", "Cliente respondeu em 72 h", "Fechou depois", "% cliente respondeu"],
        r.map((x) => [KIND[x.kind] ?? x.kind, x.previstas, x.concluidas, x.canceladas, x.noPrazo, x.comResposta, x.fechados, pctCell(x.comResposta, x.concluidas)]));
      break;
    }
    case "calor": {
      const g = await demandHeatmap(f);
      csv = toCsv(["Dia", ...Array.from({ length: 24 }, (_, h) => `${h}h`)], DAYS.map((d) => [d.n, ...g[d.i]]));
      break;
    }
    case "pessoas": {
      const r = await personVsGoal(f);
      csv = toCsv(["Pessoa", "Primeiras respostas (n)", "Mediana (s)", "Meta (s)", "% no prazo", "Mediana no período anterior (s)", "n no período anterior"],
        r.map((x) => [x.name, x.n, x.p50, x.goalSeconds, x.slaHitPct, x.previous?.p50 ?? "", x.previous?.n ?? ""]));
      break;
    }
    case "financeiro": {
      const r = await financeWithPaid(f);
      csv = toCsv(["Forma de pagamento", "Vendas", "Vendido (R$)", "Pago (R$)"], [
        ...r.byMethod.map((x) => [x.method ? PAY[x.method] ?? x.method : "Não informada", x.n, brl(x.totalCents), brl(x.pagoCents)]),
        ["Total", r.vendas, brl(r.totalCents), brl(r.pagoCents)], ["A receber", "", brl(r.aReceberCents), ""],
        [`Ticket médio (n = ${r.vendasComValor} vendas com valor)`, "", r.ticketCents == null ? "" : brl(r.ticketCents), ""],
      ]);
      break;
    }
    case "cobrancas": {
      const r = await financeWithPaid(f);
      const line = (s: string, x: ChargeItem) => [s, x.name ?? "", formatPhone(x.phone), when(x.chargeAt), brl(x.remainingCents)];
      csv = toCsv(["Situação", "Cliente", "Telefone", "Data de cobrança", "Saldo a receber (R$)"], [...r.vencidas.items.map((x) => line("Vencida", x)), ...r.aVencer.items.map((x) => line("A vencer", x))]);
      break;
    }
    default: return new Response("relatório desconhecido", { status: 404 });
  }
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": csvDisposition(tipo, PERIOD_LABEL[period]), "cache-control": "no-store" } });
}
