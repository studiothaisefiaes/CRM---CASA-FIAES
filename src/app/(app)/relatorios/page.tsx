import { requirePerm } from "@/server/auth/session";
import { desc, eq } from "drizzle-orm";
import { db } from "@/server/db";
import { reportFiles } from "@/server/db/schema";
import { PdfMenu } from "@/components/reports/pdf-menu";
import { can, canSeeSalon } from "@/lib/permissions";
import { PERIOD_LABEL, type Period } from "@/server/reports/common";
import { reportSources } from "@/server/reports/queries";
import { loadAnalysis, loadOverview } from "@/server/reports/screen";
import { activeUsers } from "@/server/domain/deals";
import { LiveRefresh } from "@/components/shell/live";
import { PageHeader } from "@/components/page-header";
import { env } from "@/server/env";
import { reportsSubtitle } from "@/lib/demo";
import { PeriodTabs } from "@/components/reports/period-tabs";
import { ExportMenu } from "@/components/reports/export-menu";
import Link from "next/link";
import { MoreReports } from "@/components/reports/more-reports";
import { ReportTabs, type ReportTab } from "@/components/reports/report-tabs";
import { OverviewTab } from "@/components/reports/overview";
import { AnalysisTab } from "@/components/reports/analysis";
import { salonRange } from "@/lib/salon-period";
import { loadSalon } from "@/server/reports/salon";
import { SalonTab } from "@/components/reports/salon";
import { SalonViews, type SalonVista } from "@/components/reports/salon-views";
import { OcupacaoTab } from "@/components/reports/ocupacao";
import { loadOcupacao } from "@/server/reports/ocupacao";
import { getRelatoriosConfig } from "@/server/domain/relatorios-config";
import { FinanceTab } from "@/components/reports/financeiro";
import { loadFinanceiro } from "@/server/reports/financeiro";
import { NotasFiscaisTab } from "@/components/reports/notas-fiscais";
import { loadNotas, notasFiscaisOn } from "@/server/reports/financeiro/notas";
import { FinanceViews, type FinanceVista } from "@/components/reports/financeiro-views";
import { ResultadoTab } from "@/components/reports/resultado";
import { assertCanSeeResultado, loadResultado } from "@/server/reports/financeiro/resultado";
import { ContasAPagar } from "@/components/reports/contas-a-pagar";
import { SalonPeriodPicker } from "@/components/reports/salon-period-picker";
import { getFinanceiroConfig } from "@/server/domain/financeiro/config";
import { listExpenses } from "@/server/domain/financeiro/despesas";
import { getMethodAccounts, listBankAccounts, listCategories } from "@/server/domain/financeiro/cadastros";
import { todayBahia } from "@/lib/salon-period";
import { loadSatisfaction } from "@/server/domain/satisfaction";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";

export const metadata = { title: "Relatórios" };

export default async function RelatoriosPage({ searchParams }: PageProps<"/relatorios">) {
  const user = await requirePerm("relatorios.ver");
  const sp = await searchParams;
  const gestor = can(user.perms, "relatorios.equipe"), money = can(user.perms, "valores.ver"), exportar = can(user.perms, "relatorios.exportar");
  const raw = ({ semana: "7d" } as Record<string, string>)[String(sp.periodo)] ?? String(sp.periodo);
  const period = (["hoje", "7d", "mes", "ano"].includes(raw) ? raw : "mes") as Period;
  const salon = canSeeSalon(user.perms);
  // Financeiro (plano 4): só quem vê valores; sem isso, a URL cai na Visão geral.
  const aba: ReportTab = sp.aba === "analise" ? "analise" : sp.aba === "salao" && salon ? "salao" : sp.aba === "financeiro" && money ? "financeiro" : "visao";
  const dated = aba === "salao" || aba === "financeiro";
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const dono = gestor && typeof sp.dono === "string" && sp.dono ? sp.dono : null;
  const source = typeof sp.origem === "string" && sp.origem ? sp.origem : null;
  // Atendimento vê os próprios números (travado em loadOverview/loadAnalysis); a gestão vê todos e filtra por pessoa.
  const filter = { period, ownerId: dono, source };
  const qs = new URLSearchParams({ periodo: period, ...(dono ? { dono } : {}), ...(source ? { origem: source } : {}) }).toString();
  const range = salonRange({ periodo: one("periodo"), de: one("de"), ate: one("ate") }, new Date());
  // Vistas do Financeiro (?vista=): a que estiver desligada em Configurações › Financeiro cai em Entradas.
  const finCfg = aba === "financeiro" ? await getFinanceiroConfig() : null;
  // Notas fiscais: com a chave da NFS-e ou da NFC-e ligada (teste ou produção) ou com alguma nota no período.
  const notasOn = finCfg ? await notasFiscaisOn(range) : false;
  const vista: FinanceVista = finCfg && sp.vista === "contas" && finCfg.contasAPagar ? "contas" : finCfg && sp.vista === "resultado" && finCfg.resultado ? "resultado" : finCfg && sp.vista === "notas" && notasOn ? "notas" : "entradas";
  if (vista === "resultado") assertCanSeeResultado(user.perms);
  // Vistas do Salão (?vista=): Ocupação só com a função ligada em Configurações › Relatórios; desligada, ?vista=ocupacao cai no Resumo.
  const relCfg = aba === "salao" ? await getRelatoriosConfig() : null;
  const salonVista: SalonVista = relCfg?.ocupacao && sp.vista === "ocupacao" ? "ocupacao" : "resumo";
  const now = new Date();
  const [people, sources, data, salonView, ocupacao, finView, contas, resultado, notasView, satisfaction, excecoesOn] = await Promise.all([
    gestor ? activeUsers() : Promise.resolve([]), reportSources(gestor ? null : user.id),
    dated ? Promise.resolve(null) : aba === "analise" ? loadAnalysis(user, filter) : loadOverview(user, filter),
    aba === "salao" && salonVista === "resumo" ? loadSalon(user, range) : Promise.resolve(null),
    aba === "salao" && salonVista === "ocupacao" ? loadOcupacao(user, range, { professionalId: one("prof"), medida: one("medida") === "valor" ? "valor" : "horarios" }) : Promise.resolve(null),
    aba === "financeiro" && vista === "entradas" ? loadFinanceiro(range) : Promise.resolve(null),
    aba === "financeiro" && vista === "contas"
      ? Promise.all([listExpenses({ from: range.from, to: range.to }, now), listCategories(), listBankAccounts(), getMethodAccounts()])
      : Promise.resolve(null),
    aba === "financeiro" && vista === "resultado" ? loadResultado(range, now) : Promise.resolve(null),
    aba === "financeiro" && vista === "notas" ? loadNotas(range) : Promise.resolve(null),
    // Pesquisa de satisfação (Fase B): só com relatorios.equipe (loadSatisfaction devolve null sem ela).
    aba === "salao" ? loadSatisfaction(user, range) : Promise.resolve(null),
    aba === "financeiro" ? getCaixaRecursos().then((r) => r.excecoes) : Promise.resolve(false),
  ]);
  const finQs = new URLSearchParams(range.preset === "livre" ? { de: range.from, ate: range.to } : { periodo: range.preset }).toString();
  const monthly = exportar && gestor && money ? await db.select({ id: reportFiles.id, periodKey: reportFiles.periodKey }).from(reportFiles).where(eq(reportFiles.kind, "mensal")).orderBy(desc(reportFiles.periodKey)).limit(12) : [];
  return (
    <main className="pb-16">
      {/* Relatórios não assinam a Fila: só vendas/fechamentos, a cada 60 s e ao voltar para a aba. */}
      <LiveRefresh scopes={["reports"]} pollMs={60_000} />
      {/* Dois níveis (dsgfix, r68 #6): as abas logo abaixo do título e, numa linha própria, a vista, o período, os filtros e a exportação. */}
      <PageHeader title="Relatórios" subtitle={reportsSubtitle(dated ? range.label : PERIOD_LABEL[period], env().DEMO)}
        tabs={<ReportTabs value={aba} perms={user.perms} />}
        toolbar={<>
          {relCfg?.ocupacao && <SalonViews value={salonVista} />}
          {finCfg && <FinanceViews value={vista} notas={notasOn} contas={finCfg.contasAPagar} resultado={finCfg.resultado} />}
          {dated
            ? <SalonPeriodPicker key={`${aba}-${vista}-${salonVista}`} preset={range.preset} from={range.from} to={range.to} aba={aba === "financeiro" ? "financeiro" : "salao"}
                vista={aba === "financeiro" ? (vista === "entradas" ? undefined : vista) : salonVista === "ocupacao" ? "ocupacao" : undefined} />
            : <PeriodTabs people={people} origins={sources} />}
          {!dated && exportar && <div className="flex items-center gap-2 lg:ml-auto"><ExportMenu qs={qs} team={gestor} money={money} /><PdfMenu periodo={period} team={gestor} /></div>}
        </>} />
      <div className="px-5 lg:px-8 flex flex-col gap-8 max-w-[1480px]">
        <div role="tabpanel" id="rel-panel" aria-labelledby={`rel-tab-${aba}`} className="min-w-0">
          {contas && finCfg ? (
            <div className="flex flex-col gap-8">
              <ContasAPagar rows={contas[0]} categories={contas[1]} accounts={contas[2]} methodAccounts={contas[3]} venceEmDias={finCfg.venceEmDias} repetirMaxMeses={finCfg.repetirMaxMeses} today={todayBahia(now)}
                can={{ lancar: can(user.perms, "financeiro.lancar"), pagar: can(user.perms, "financeiro.pagar"), cancelar: can(user.perms, "financeiro.cancelar"), cadastros: can(user.perms, "financeiro.cadastros") }} />
            </div>
          ) : notasView ? (
            <NotasFiscaisTab range={range} notas={notasView.notas} parceiras={notasView.parceiras} aEmitir={notasView.aEmitir} />
          ) : resultado ? (
            <ResultadoTab v={resultado} />
          ) : finView ? <FinanceTab d={finView} excelHref={exportar ? `/api/relatorios/excel-financeiro?${finQs}` : null} canCommission={can(user.perms, "comissao.ver")} canExcecoes={can(user.perms, "relatorios.excecoes") && excecoesOn} />
            : ocupacao ? <OcupacaoTab d={ocupacao} />
            : salonView ? <SalonTab d={salonView} satisfaction={satisfaction} />
            : data && ("followup" in data
              ? <AnalysisTab data={data} qs={qs} />
              : <OverviewTab data={data} period={period} qs={qs} gestor={money} scope={{ dono, fonte: source }} />)}
        </div>
        {aba === "visao" && <MoreReports perms={user.perms} />}
        {exportar && gestor && money && monthly.length > 0 && (
          <section aria-labelledby="fechamentos-t" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <h2 id="fechamentos-t" className="text-sm font-semibold text-graphite">Fechamentos do mês (PDF)</h2>
            {monthly.map((m) => <a key={m.id} href={`/api/relatorios/arquivo/${m.id}`} className="inline-flex items-center min-h-11 lg:min-h-8 text-gold-ink underline underline-offset-2 hover:text-ink">{monthName(m.periodKey)}</a>)}
          </section>
        )}
      </div>
    </main>
  );
}

/** "2026-09" → "setembro de 2026". */
const monthName = (key: string) => new Date(`${key}-15T12:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Bahia" });
