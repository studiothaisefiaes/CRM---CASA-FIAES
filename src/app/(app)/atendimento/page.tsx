import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getBulkOptions, getQueue, getQueueItem, queueStageLabel } from "@/server/queries/queue";
import { LiveRefresh } from "@/components/shell/live";
import { ConversationPaneRoute } from "@/components/queue/conversation-pane";
import { QueueRestore } from "@/components/queue/queue-route";
import { QueueColumn } from "@/components/queue/queue-column";
import { WorkspaceBar } from "@/components/queue/workspace-bar";
import { parseQueueFilter } from "@/lib/report-links";
import { parseQueueFoco, parseQueueView, queueQuery } from "@/lib/queue";
import { isMobileUserAgent } from "@/lib/device";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Atendimento" };

export default async function AtendimentoPage({ searchParams }: PageProps<"/atendimento">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && (sp[k] as string).trim() ? (sp[k] as string).trim().slice(0, 80) : null);
  const view = parseQueueView(sp.view);
  const filtro = parseQueueFilter(sp.filtro);
  const q = str("q"), dono = str("dono"), etapa = str("etapa"), fonte = str("fonte");
  const lead = str("lead");
  const leadId = isUuid(lead) ? lead : null;
  // Celular: a conversa é uma tela própria. Decide aqui, antes de carregar e montar o lead; o ViewportRedirect cobre o resto (janela estreita no desktop).
  if (leadId && isMobileUserAgent((await headers()).get("user-agent"))) redirect(`/atendimento/${leadId}`);
  const foco = parseQueueFoco(sp.foco);
  const [queue, bulk, etapaName] = await Promise.all([getQueue(user, { view, foco, q, filtro, dono, etapa, fonte }), getBulkOptions(user), queueStageLabel(etapa)]);
  const query = queueQuery({ view: str("view") ? view : null, foco, filtro, etapa, dono, fonte, q });
  // O painel abre com o item da Fila (nome, foto, espera, última mensagem) e busca a conversa depois. Fora da lista (filtro, busca), pede só esse lead.
  const serverItem = leadId ? queue.sections.flatMap((s) => s.items).find((i) => i.dealId === leadId) ?? await getQueueItem(leadId) : null;
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh overflow-hidden flex flex-col">
      <WorkspaceBar current="fila" journey={user.role === "gestor"} />
      <QueueRestore hasParams={Object.keys(sp).length > 0} />
      <LiveRefresh scopes={["queue"]} />
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
        <QueueColumn queue={queue} query={query} view={view} foco={foco} filtro={filtro} q={q} fonte={fonte} etapaName={etapaName} onlyOwnLabel={user.role !== "gestor"} selectedId={leadId} bulk={bulk} />
        <ConversationPaneRoute serverLead={leadId} serverItem={serverItem} />
      </div>
    </main>
  );
}
