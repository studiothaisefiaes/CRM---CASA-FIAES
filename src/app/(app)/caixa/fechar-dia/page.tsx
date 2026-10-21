import { FechamentosHistorico } from "@/components/caixa/fechamentos-historico";
import { requirePerm } from "@/server/auth/session";
import { loadFecharDia } from "@/server/queries/fechar-dia";
import { buildComandaCatalog } from "@/server/queries/comanda-catalog";
import { listPaymentOptions } from "@/server/domain/caixa/payment-options";
import { PageBack, PageHeader } from "@/components/page-header";
import { LiveRefresh } from "@/components/shell/live";
import { ComandaProvider } from "@/components/caixa/comanda-provider";
import { CloseDay, type CloseDayStep } from "@/components/fechar-dia/close-day";
import { firstPendingStep } from "@/lib/fechar-dia-steps";

export const metadata = { title: "Fechar o dia" };
const DIA = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/**
 * Caixa › Fechar o dia (plano 4): horários sem desfecho, comandas abertas e o caixa, em três passos (`?passo=`). Funciona com o caixa no
 * Avec também: aí o passo 3 é só o aviso. Substitui o Sem baixa e o Fechar caixa espalhados.
 */
export default async function FecharDiaPage({ searchParams }: PageProps<"/caixa/fechar-dia">) {
  const user = await requirePerm("caixa.operar");
  const sp = await searchParams;
  const [data, options] = await Promise.all([loadFecharDia(user), listPaymentOptions({ activeOnly: true })]);
  // Sem ?passo=, abre no primeiro passo que tem pendência (r66 #17).
  const step = (["1", "2", "3"].includes(String(sp.passo)) ? Number(sp.passo) : firstPendingStep(data.noOutcome.length, data.comandas.length)) as CloseDayStep;
  const body = <CloseDay today={data.today} noOutcome={data.noOutcome} comandas={data.comandas} cash={data.cash} step={step} hasOptions={options.length > 0} />;
  let content = body;
  if (data.cash.mode === "crm") {
    const catalog = await buildComandaCatalog(user);
    content = <ComandaProvider catalog={catalog}>{body}</ComandaProvider>;
  }
  const day = DIA.format(new Date(`${data.today}T12:00:00Z`));
  return (
    <main className="pb-12">
      <LiveRefresh scopes={["caixa"]} />
      <PageHeader title="Fechar caixa / dia" subtitle={day.charAt(0).toUpperCase() + day.slice(1)} back={<PageBack href="/caixa">Caixa</PageBack>} />
      {/* Mesma largura das outras telas (r68 #16): o contêiner é o da página, sem um máximo só dela. */}
      <div className="px-5 lg:px-8">{content}<FechamentosHistorico user={user} /></div>
    </main>
  );
}
