import { requireUser } from "@/server/auth/session";
import { PERIOD_LABEL, type Period } from "@/server/reports/common";
import { reportSources } from "@/server/reports/queries";
import { loadAnalysis, loadOverview } from "@/server/reports/screen";
import { activeUsers } from "@/server/domain/deals";
import { PageHeader } from "@/components/page-header";
import { PeriodTabs } from "@/components/reports/period-tabs";
import { ExportMenu } from "@/components/reports/export-menu";
import { ReportTabs, type ReportTab } from "@/components/reports/report-tabs";
import { OverviewTab } from "@/components/reports/overview";
import { AnalysisTab } from "@/components/reports/analysis";

export const metadata = { title: "Relatórios" };

export default async function RelatoriosPage({ searchParams }: PageProps<"/relatorios">) {
  const user = await requireUser();
  const sp = await searchParams;
  const gestor = user.role === "gestor";
  const raw = ({ semana: "7d" } as Record<string, string>)[String(sp.periodo)] ?? String(sp.periodo);
  const period = (["hoje", "7d", "mes", "ano"].includes(raw) ? raw : "mes") as Period;
  const aba: ReportTab = sp.aba === "analise" ? "analise" : "visao";
  const dono = gestor && typeof sp.dono === "string" && sp.dono ? sp.dono : null;
  const source = typeof sp.origem === "string" && sp.origem ? sp.origem : null;
  // Atendimento vê os próprios números (travado em loadOverview/loadAnalysis); a gestão vê todos e filtra por pessoa.
  const filter = { period, ownerId: dono, source };
  const qs = new URLSearchParams({ periodo: period, ...(dono ? { dono } : {}), ...(source ? { origem: source } : {}) }).toString();
  const [people, sources, data] = await Promise.all([
    gestor ? activeUsers() : Promise.resolve([]), reportSources(gestor ? null : user.id),
    aba === "analise" ? loadAnalysis(user, filter) : loadOverview(user, filter),
  ]);
  return (
    <main className="pb-16">
      <PageHeader title="Relatórios" subtitle={`${PERIOD_LABEL[period]} · números reais do CRM`}
        actions={<><PeriodTabs people={people} origins={sources} /><ExportMenu qs={qs} gestor={gestor} /></>} />
      <div className="px-5 lg:px-8 flex flex-col gap-8 max-w-[1280px]">
        <ReportTabs value={aba} />
        <div role="tabpanel" id="rel-panel" aria-labelledby={`rel-tab-${aba}`} className="min-w-0">
          {"followup" in data
            ? <AnalysisTab data={data} qs={qs} />
            : <OverviewTab data={data} period={period} qs={qs} gestor={gestor} scope={{ dono, fonte: source }} />}
        </div>
      </div>
    </main>
  );
}
