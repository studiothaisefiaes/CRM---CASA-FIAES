import { CaixaNav } from "@/components/caixa/caixa-nav";
import { requirePerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { CAIXA_OFF } from "@/lib/caixa-settings";
import { ensureArrivedComandas } from "@/server/domain/caixa/arrivals";
import { todayBahia } from "@/lib/agenda";
import { getCaixaHoje } from "@/server/queries/caixa";
import { buildComandaCatalog } from "@/server/queries/comanda-catalog";
import { listProfessionals } from "@/server/domain/professionals";
import { listMovements } from "@/server/domain/caixa/cash";
import { MovementsList } from "@/components/caixa/movements-list";
import { getCaixaMode } from "@/server/domain/caixa/mode";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { listPaymentOptions } from "@/server/domain/caixa/payment-options";
import { PageHeader } from "@/components/page-header";
import { LiveRefresh } from "@/components/shell/live";
import { Empty } from "@/components/ui/empty";
import { ComandaProvider } from "@/components/caixa/comanda-provider";
import { CaixaWorkspace } from "@/components/caixa/caixa-workspace";
import { CashClosed, CashHeader } from "@/components/caixa/cash-header";
import { cashStatus } from "@/lib/caixa-status";

export const metadata = { title: "Caixa" };

/** Caixa (Plano 3): cada pessoa abre e fecha o seu; a fila A receber à esquerda e a comanda à direita. */
export default async function CaixaPage() {
  const user = await requirePerm("caixa.operar");
  // Quem já chegou ganha a comanda dos serviços da visita (só com o caixa ligado no CRM).
  if (await getCaixaMode() === "crm") await ensureArrivedComandas(todayBahia(new Date()), { id: user.id, perms: user.perms });
  const data = await getCaixaHoje(user);
  const canGerir = can(user.perms, "caixa.gerir");
  const tabs = <CaixaNav perms={user.perms} current="caixa" />;
  if (data.mode !== "crm") return (
    <main className="pb-12">
      <PageHeader title="Caixa" tabs={tabs} />
      <div className="px-5 lg:px-8"><Empty title={CAIXA_OFF}>{can(user.perms, "config.sistema") ? "A gestão liga em Configurações › Caixa. Pacotes à venda e comissão já podem ser preparados." : "Por enquanto, receba no Avec."}</Empty></div>
    </main>
  );
  const options = await listPaymentOptions({ activeOnly: true });
  // "É vale de uma profissional?" só aparece ligado (vales + valePelaSangria) e com caixa.vale; sem acesso ao app, a sangria explica como cadastrar.
  const recursos = await getCaixaRecursos();
  const valeProfessionals = recursos.vales && recursos.valePelaSangria && can(user.perms, "caixa.vale") ? (await listProfessionals()).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })) : undefined;
  const catalog = await buildComandaCatalog(user, { today: data.day, paymentOptions: options.map((o) => ({ id: o.id, label: o.label })) });
  return (
    <main className="pb-12">
      <LiveRefresh scopes={["caixa"]} />
      <PageHeader title="Caixa" subtitle={cashStatus(data.myName, data.mine)} tabs={tabs}
        actions={<CashHeader name={data.myName} mine={data.mine} canGerir={canGerir} hasOptions={options.length > 0} valeProfessionals={valeProfessionals} />} />
      <div className="px-5 lg:px-8">
        {data.mine && <MovementsList rows={await listMovements(data.mine.sessionId)} />}
        <ComandaProvider catalog={catalog}>
          {data.mine ? <CaixaWorkspace data={data} catalog={catalog} nowIso={new Date().toISOString()} />
            : <CashClosed name={data.myName} canSkip={!data.rules.exigeCaixaAberto}><CaixaWorkspace data={data} catalog={catalog} nowIso={new Date().toISOString()} /></CashClosed>}
        </ComandaProvider>
      </div>
    </main>
  );
}
