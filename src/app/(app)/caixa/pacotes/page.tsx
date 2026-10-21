import Link from "next/link";
import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { todayBahia } from "@/lib/agenda";
import { listPackagesNeedingAttention } from "@/server/queries/caixa";
import { PageBack, PageHeader } from "@/components/page-header";
import { ClientPackageActions } from "@/components/caixa/client-package-actions";

export const metadata = { title: "Pacotes das clientes" };

/**
 * Os pacotes das clientes que pedem a gestão: dar novo prazo (caixa.gerir) e valor por sessão (config.sistema).
 * O catálogo (pacotes à venda) fica só em Serviços e pacotes › Pacotes (Plano 5, spec "Juntar e tirar").
 */
export default async function PacotesPage() {
  const user = await requireAnyPerm("config.sistema", "caixa.gerir");
  const attention = await listPackagesNeedingAttention(todayBahia(new Date()));
  return (
    <main className="pb-12">
      <PageHeader title="Pacotes das clientes" subtitle="Novo prazo e valor por sessão" back={<PageBack href="/servicos?aba=pacotes">Serviços e pacotes</PageBack>} />
      <div className="flex flex-col gap-6 px-5 lg:px-8">
        <p className="text-sm text-graphite">Os pacotes à venda ficam em <Link href="/servicos?aba=pacotes" className="font-medium text-gold-ink underline-offset-4 hover:underline">Serviços e pacotes › Pacotes</Link>.</p>
        <ClientPackageActions vencidos={attention.vencidos} semValor={attention.semValor} canExtend={can(user.perms, "caixa.gerir")} canValue={can(user.perms, "config.sistema")} />
      </div>
    </main>
  );
}
