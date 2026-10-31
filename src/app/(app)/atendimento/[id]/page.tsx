import { headers } from "next/headers";
import { can } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { requirePerm } from "@/server/auth/session";
import { getBulkOptions, getQueue, getQueueFilterOptions, getQueueItem } from "@/server/queries/queue";
import { getShellBanners } from "@/server/queries/banners";
import { LiveRefresh } from "@/components/shell/live";
import { QueueColumn } from "@/components/queue/queue-column";
import { WorkspaceBar } from "@/components/queue/workspace-bar";
import { NewConversationButton } from "@/components/queue/new-conversation";
import { ConversationPane } from "@/components/queue/conversation-pane";
import { isMobileUserAgent } from "@/lib/device";
import { isUuid } from "@/lib/uuid";
import { getTeamNow } from "@/server/queries/team-now";
import { listTags } from "@/server/domain/tags";
import { countScheduled } from "@/server/queries/scheduled-list";
import { getDayProgressLine } from "@/server/queries/day-progress";

export const metadata = { title: "Conversa" };

/**
 * A conversa de um lead, em qualquer largura. Esta rota nunca redireciona para outra largura (quem decide por largura é só o CSS), então não há ida e volta:
 * no desktop (≥ 1024 px) mostra os painéis (fila | conversa | cliente) com este lead aberto; no celular, a conversa em tela cheia com o botão de voltar para a fila.
 * Com User-Agent de celular não monta a lista (não vai aparecer), e a tela cheia vale mesmo com a janela larga.

 * O aviso de WhatsApp caído (`wa`) fica no cabeçalho do celular, onde a faixa global não aparece.
 * O servidor só entrega o item da Fila (cabeçalho na hora); o histórico e os dados chegam pela Server Action do painel.
 */
export default async function ConversaPage({ params, searchParams }: PageProps<"/atendimento/[id]">) {
  const user = await requirePerm("atendimento.ver");
  const { id } = await params;
  const sp = await searchParams;
  const compose = sp.compose === "1"; // vindo de "Iniciar conversa": o cursor já abre no campo de mensagem
  const agendar = sp.agendar === "1"; // vindo do "Agendar" da ficha: a folha Agendar já abre
  const parabens = sp.parabens === "1"; // vindo do "Mandar parabéns" do Hoje: o campo já vem com a mensagem (nada é enviado)
  if (!isUuid(id)) notFound();
  const withList = !isMobileUserAgent((await headers()).get("user-agent"));
  const etiqueta = typeof sp.etiqueta === "string" && isUuid(sp.etiqueta) ? sp.etiqueta : null;
  const [item, queue, banners, bulk, team, tagList, options, programadas, dayProgress] = await Promise.all([getQueueItem(id), withList ? getQueue(user, { etiqueta }) : Promise.resolve(null), getShellBanners(), withList ? getBulkOptions(user) : Promise.resolve(null), withList ? getTeamNow() : Promise.resolve(undefined), withList ? listTags() : Promise.resolve([]), withList ? getQueueFilterOptions(user) : Promise.resolve({ stages: [], owners: [], ads: [] }),
    // O número ao lado de "Programadas", igual ao da Fila (Plano 5): só com a lista na tela, onde a barra aparece.
    withList ? countScheduled(user) : Promise.resolve(undefined), withList ? getDayProgressLine() : Promise.resolve(null)]);
  if (!item) notFound();
  const cols = withList ? "lg:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[340px_minmax(0,1fr)_320px]" : "2xl:grid-cols-[minmax(0,1fr)_320px]";
  return (
    <main className="h-dvh overflow-hidden flex flex-col">
      <h1 className={withList ? "sr-only lg:hidden" : "sr-only"}>Conversa</h1>{/* com a lista na tela (≥ lg) o h1 é o "Conversas" da barra */}
      {withList && <WorkspaceBar current="fila" quadro={can(user.perms, "quadro.ver")} programadas={programadas} className="hidden lg:flex" action={<NewConversationButton className="max-lg:hidden" />} />}
      <LiveRefresh scopes={["queue", "team"]} />
      <div className={`flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)] ${cols}`}>
      {queue && bulk && <QueueColumn queue={queue} query="" params={{ etiqueta }} onlyOwnLabel={false} selectedId={id} className="hidden lg:flex" bulk={bulk} team={team} options={{ ...options, tags: tagList }} programadas={programadas} progress={dayProgress} />}
      <ConversationPane key={id} dealId={id} initial={queue?.sections.flatMap((s) => s.items).find((i) => i.dealId === id) ?? item} back={withList ? "below-lg" : "always"} focusComposer={compose || parabens} prefillReply={parabens ? "aniversario" : null} openSchedule={agendar}
        wa={{ down: banners.disconnected, href: can(user.perms, "config.sistema") ? "/config/whatsapp" : "/atendimento" }} />
      </div>
    </main>
  );
}
