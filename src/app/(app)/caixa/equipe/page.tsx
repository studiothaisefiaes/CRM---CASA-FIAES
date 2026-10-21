import { CaixaNav } from "@/components/caixa/caixa-nav";
import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { listTeamCash } from "@/server/queries/caixa";
import { getCaixaMode, getCaixaRules } from "@/server/domain/caixa/mode";
import { listPaymentOptions } from "@/server/domain/caixa/payment-options";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Empty } from "@/components/ui/empty";
import { LiveRefresh } from "@/components/shell/live";
import { CAIXA_OFF } from "@/lib/caixa-settings";
import { TeamCash } from "@/components/caixa/team-cash";
import { CaixaRulesForm } from "@/components/caixa/caixa-rules-form";

export const metadata = { title: "Caixas da equipe" };

/**
 * Caixa › Caixas da equipe (gestão, caixa.outros; aprovar, caixa.gerir): cada caixa aberto e os fechados hoje, quem abriu, o que entrou e
 * a diferença. Só operação (dsgfix, r68 #4): as regras do fechamento moram em Configurações › Caixa; quem gere o caixa sem acesso às
 * Configurações as acha aqui, numa seção recolhida.
 */
export default async function CaixasDaEquipePage() {
  const user = await requirePerm("caixa.outros");
  const [mode, rows, rules, options] = await Promise.all([getCaixaMode(), listTeamCash(), getCaixaRules(), listPaymentOptions({ activeOnly: true })]);
  return (
    <main className="pb-12">
      <LiveRefresh scopes={["caixa"]} />
      <PageHeader title="Caixas da equipe" subtitle="Cada pessoa abre e fecha o seu caixa" tabs={<CaixaNav perms={user.perms} current="equipe" />}
        actions={can(user.perms, "caixa.gerir") && can(user.perms, "config.sistema")
          ? <Link href="/config/caixa#regras-fechamento" className="inline-flex min-h-11 items-center text-sm font-medium text-gold-ink underline-offset-4 hover:underline lg:min-h-9">Regras do fechamento ›</Link> : undefined} />
      <div className="flex flex-col gap-8 px-5 lg:px-8">
        {mode !== "crm" ? <Empty title={CAIXA_OFF}>Os caixas aparecem aqui quando o caixa do CRM for ligado.</Empty>
          : rows.length ? <TeamCash rows={rows} viewerId={user.id} hasOptions={options.length > 0} canGerir={can(user.perms, "caixa.gerir")} />
          : <Empty title="Nenhum caixa aberto hoje">Quem recebe abre o próprio caixa em Caixa › Abrir caixa.</Empty>}
        {can(user.perms, "caixa.gerir") && !can(user.perms, "config.sistema") && (
          <details className="group max-w-2xl">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-graphite hover:text-ink [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="transition-transform group-open:rotate-90">›</span> Regras do fechamento
            </summary>
            <div className="mt-3"><CaixaRulesForm rules={rules} /></div>
          </details>
        )}
      </div>
    </main>
  );
}
