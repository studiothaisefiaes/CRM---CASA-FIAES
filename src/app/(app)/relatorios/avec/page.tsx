import { redirect } from "next/navigation";
import { canSeeAvecReports } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { listAvecReports } from "@/server/queries/avec";
import { PageBack, PageHeader } from "@/components/page-header";
import { Empty } from "@/components/ui/empty";
import { AvecUploadButton } from "@/components/relatorios-avec/upload-button";
import { organizeAvecReports } from "@/lib/avec-catalog";
import { AvecCatalogView } from "@/components/relatorios-avec/catalog";

export const metadata = { title: "Relatórios do Avec" };

/** Relatórios do Avec guardados (tabela saneada): os 11 principais em cartões, os outros por assunto, vazios no fim. Só a gestão (canSeeAvecReports). */
export default async function RelatoriosAvecPage() {
  const user = await requirePerm("relatorios.ver");
  if (!canSeeAvecReports(user.perms)) redirect("/relatorios?aviso=sem-permissao");
  const reports = await listAvecReports();
  const catalog = organizeAvecReports(reports);
  const types = new Set(reports.map((r) => r.title)).size;
  return (
    <main className="pb-16">
      <PageHeader title="Relatórios do Avec"
        subtitle={reports.length ? `${reports.length.toLocaleString("pt-BR")} ${reports.length === 1 ? "relatório guardado" : "relatórios guardados"} em ${types} ${types === 1 ? "tipo" : "tipos"}` : "Agenda, clientes, pacotes e vendas que vêm do Avec"}
        actions={<AvecUploadButton />} back={<PageBack href="/relatorios">Relatórios</PageBack>} />
      <div className="px-5 lg:px-8 max-w-[1480px]">
        {reports.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
            <Empty title="Nenhum relatório do Avec ainda" action={<AvecUploadButton label="Enviar os primeiros" />}>
              No Avec, exporte os relatórios em Excel (.xlsx) e envie aqui, vários de uma vez. O CRM guarda cada tabela sem CPF, RG, endereço e dados de banco, e põe na agenda, nos contatos e nos pacotes o que vier neles.
            </Empty>
          </div>
        ) : <AvecCatalogView catalog={catalog} />}
      </div>
    </main>
  );
}
