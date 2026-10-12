import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getBulkOptions, getQueue, getQueueItem } from "@/server/queries/queue";
import { getShellBanners } from "@/server/queries/banners";
import { LiveRefresh } from "@/components/shell/live";
import { QueueColumn } from "@/components/queue/queue-column";
import { WorkspaceBar } from "@/components/queue/workspace-bar";
import { ConversationPane } from "@/components/queue/conversation-pane";
import { isMobileUserAgent } from "@/lib/device";
import { isUuid } from "@/lib/uuid";

export const metadata = { title: "Conversa" };

/**
 * A conversa de um lead, em qualquer largura. Esta rota nunca redireciona para outra largura (quem decide por largura é só o CSS), então não há ida e volta:
 * no desktop (≥ 1024 px) mostra os painéis (fila | conversa | cliente) com este lead aberto; no celular, a conversa em tela cheia com o botão de voltar para a fila.
 * Com User-Agent de celular não monta a lista (não vai aparecer), e a tela cheia vale mesmo com a janela larga.

 * O aviso de WhatsApp caído (`wa`) fica no cabeçalho do celular, onde a faixa global não aparece.
 * O servidor só entrega o item da Fila (cabeçalho na hora); o histórico e os dados chegam pela Server Action do painel.
 */
export default async function ConversaPage({ params, searchParams }: PageProps<"/atendimento/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const compose = (await searchParams).compose === "1"; // vindo de "Iniciar conversa": o cursor já abre no campo de mensagem
  if (!isUuid(id)) notFound();
  const withList = !isMobileUserAgent((await headers()).get("user-agent"));
  const [item, queue, banners, bulk] = await Promise.all([getQueueItem(id), withList ? getQueue(user, {}) : Promise.resolve(null), getShellBanners(), withList ? getBulkOptions(user) : Promise.resolve(null)]);
  if (!item) notFound();
  const cols = withList ? "lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]" : "xl:grid-cols-[minmax(0,1fr)_300px]";
  return (
    <main className="h-dvh overflow-hidden flex flex-col">
      <h1 className={withList ? "sr-only lg:hidden" : "sr-only"}>Conversa</h1>{/* com a lista na tela (≥ lg) o h1 é o "Atendimento" da barra */}
      {withList && <WorkspaceBar current="fila" journey={user.role === "gestor"} className="hidden lg:flex" />}
      <LiveRefresh scopes={["queue"]} />
      <div className={`flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)] ${cols}`}>
      {queue && bulk && <QueueColumn queue={queue} query="" view="todos" foco={null} filtro={null} q={null} fonte={null} onlyOwnLabel={false} selectedId={id} className="hidden lg:flex" bulk={bulk} />}
      <ConversationPane key={id} dealId={id} initial={queue?.sections.flatMap((s) => s.items).find((i) => i.dealId === id) ?? item} back={withList ? "below-lg" : "always"} focusComposer={compose}
        wa={{ down: banners.disconnected, href: user.role === "gestor" ? "/config/whatsapp" : "/atendimento" }} />
      </div>
    </main>
  );
}
