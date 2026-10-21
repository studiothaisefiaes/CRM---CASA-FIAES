import { headers } from "next/headers";
import { can } from "@/lib/permissions";
import { redirect } from "next/navigation";
import { requirePerm } from "@/server/auth/session";
import { getBulkOptions, getQueue, getQueueFilterOptions, getQueueItem } from "@/server/queries/queue";
import { LiveRefresh } from "@/components/shell/live";
import { ConversationPaneRoute } from "@/components/queue/conversation-pane";
import { QueueRestore } from "@/components/queue/queue-route";
import { QueueColumn } from "@/components/queue/queue-column";
import { WorkspaceBar, WorkspaceTabsCompact } from "@/components/queue/workspace-bar";
import { NewConversationButton } from "@/components/queue/new-conversation";
import { parseQueueFilter } from "@/lib/report-links";
import { parseDias, parseEtiquetaRegra, parseQueueAba, parseQueueFoco, parseQueueView, queueQuery } from "@/lib/queue";
import { isMobileUserAgent } from "@/lib/device";
import { isUuid } from "@/lib/uuid";
import { getTeamNow } from "@/server/queries/team-now";
import { listTags } from "@/server/domain/tags";
import { countScheduled } from "@/server/queries/scheduled-list";
import { getDayProgressLine } from "@/server/queries/day-progress";

export const metadata = { title: "Conversas" };

export default async function AtendimentoPage({ searchParams }: PageProps<"/atendimento">) {
  const user = await requirePerm("atendimento.ver");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && (sp[k] as string).trim() ? (sp[k] as string).trim().slice(0, 80) : null);
  // URL antiga (view=arquivadas / view=encerradas): a lista agora se chama Resolvidas.
  if (sp.view === "arquivadas" || sp.view === "encerradas") {
    const qs = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, k === "view" ? "resolvidas" : v]] : [])));
    redirect(`/atendimento?${qs}`);
  }
  const view = parseQueueView(sp.view);
  const filtro = parseQueueFilter(sp.filtro);
  const q = str("q"), dono = str("dono"), etapa = str("etapa"), fonte = str("fonte");
  const lead = str("lead");
  const etiqueta = isUuid(str("etiqueta")) ? str("etiqueta") : null;
  const etiquetasList = (str("etiquetas") ?? "").split(",").filter((t) => isUuid(t)).slice(0, 10);
  const etiquetas = etiquetasList.length ? etiquetasList.join(",") : null;
  const regra = str("regra");
  const dias = parseDias(str("dias"));
  const setor = isUuid(str("setor")) ? str("setor") : null;
  const leadId = isUuid(lead) ? lead : null;
  // Celular: a conversa é uma tela própria. Decide aqui, antes de carregar e montar o lead; o ViewportRedirect cobre o resto (janela estreita no desktop).
  if (leadId && isMobileUserAgent((await headers()).get("user-agent"))) redirect(`/atendimento/${leadId}`);
  const foco = parseQueueFoco(sp.foco);
  const aba = view === "arquivadas" || view === "equipe" || view === "fornecedores" || view === "nao-cliente" ? null : parseQueueAba(sp.aba);
  const [queue, bulk, team, tagList, options, programadas, dayProgress] = await Promise.all([getQueue(user, { view, aba, foco, q, filtro, dono, etapa, fonte, etiqueta, etiquetas: etiquetasList, regraEtiqueta: parseEtiquetaRegra(regra), diasSemConversa: dias, setor }), getBulkOptions(user), getTeamNow(), listTags(), getQueueFilterOptions(user), countScheduled(user), getDayProgressLine()]);
  const params = { view: str("view") ? view : null, aba, foco, filtro, etapa, dono, fonte, etiqueta, etiquetas, regra: regra ? parseEtiquetaRegra(regra) : null, dias: dias ? String(dias) : null, q };
  const query = queueQuery(params);
  // O painel abre com o item da Fila (nome, foto, espera, última mensagem) e busca a conversa depois. Fora da lista (filtro, busca), pede só esse lead.
  const serverItem = leadId ? queue.sections.flatMap((s) => s.items).find((i) => i.dealId === leadId) ?? await getQueueItem(leadId) : null;
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh overflow-hidden flex flex-col">
      <WorkspaceBar className="lg:hidden" current="fila" quadro={can(user.perms, "quadro.ver")} programadas={programadas} />
      <QueueRestore hasParams={Object.keys(sp).length > 0} />
      <LiveRefresh scopes={["queue", "team"]} />
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)_320px]">
        <QueueColumn queue={queue} query={query} params={params} onlyOwnLabel={!can(user.perms, "atendimento.todas")} selectedId={leadId} bulk={bulk} team={team} options={{ ...options, tags: tagList }} programadas={programadas} progress={dayProgress}
          top={<WorkspaceTabsCompact current="fila" quadro={can(user.perms, "quadro.ver")} programadas={programadas} action={<NewConversationButton compact className="ml-auto size-8 rounded-full" />} />} />
        <ConversationPaneRoute serverLead={leadId} serverItem={serverItem} />
      </div>
    </main>
  );
}
