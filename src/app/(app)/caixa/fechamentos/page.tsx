import { redirect } from "next/navigation";
import { requireAnyPerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { PageBack, PageHeader } from "@/components/page-header";
import { FechamentosHistorico } from "@/components/caixa/fechamentos-historico";

export const metadata = { title: "Fechamentos" };

/**
 * O histórico mora dentro de "Fechar caixa / dia"; quem opera o caixa vai para lá. Quem só VÊ os caixas da equipe (caixa.outros, sem
 * operar: o Contador, 26/10) abre aqui só o histórico, sem Fechar o dia e sem Reabrir (caixa.gerir).
 */
export default async function FechamentosPage() {
  const user = await requireAnyPerm("caixa.operar", "caixa.outros");
  if (can(user.perms, "caixa.operar")) redirect("/caixa/fechar-dia#historico");
  return (
    <main className="pb-12">
      <PageHeader title="Fechamentos de caixa" subtitle="Os últimos caixas de cada pessoa" back={<PageBack href="/relatorios?aba=financeiro">Relatórios</PageBack>} />
      <div className="px-5 lg:px-8"><FechamentosHistorico user={user} /></div>
    </main>
  );
}
