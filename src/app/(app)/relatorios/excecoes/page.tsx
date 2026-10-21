import { notFound } from "next/navigation";
import { requirePerm } from "@/server/auth/session";
import { getCaixaRecursos } from "@/server/domain/caixa/recursos";
import { salonRange } from "@/lib/salon-period";
import { financeExceptions, EXCEPTION_LABEL, type ExceptionKind } from "@/server/reports/financeiro/excecoes";
import { PageHeader } from "@/components/page-header";
import { LiveRefresh } from "@/components/shell/live";
import { ExcecoesPage } from "@/components/reports/excecoes-page";

export const metadata = { title: "Exceções" };

/**
 * Exceções (Fase A, Tarefa 11): descontos, cortesias, preços e profissionais mudados, cancelamentos, assistente trocada, com quem fez e o motivo.
 * Mesmo acesso do Financeiro (ver Relatórios e valores) mais "Ver as Exceções"; desligada em Configurações › Caixa, a página não existe.
 */
export default async function ExcecoesRoute({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await requirePerm("relatorios.ver");
  await requirePerm("valores.ver");
  await requirePerm("relatorios.excecoes");
  if (!(await getCaixaRecursos()).excecoes) notFound();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const range = salonRange({ periodo: one("periodo"), de: one("de"), ate: one("ate") }, new Date());
  const t = one("tipo");
  const tipo = t && Object.hasOwn(EXCEPTION_LABEL, t) ? (t as ExceptionKind) : null;
  const exceptions = await financeExceptions(range);
  return (
    <main className="pb-16">
      <LiveRefresh scopes={["reports"]} pollMs={60_000} />
      <PageHeader title="Exceções" subtitle={range.label} />
      <div className="px-5 lg:px-8 max-w-[1480px]"><ExcecoesPage range={range} exceptions={exceptions} tipo={tipo} /></div>
    </main>
  );
}
