import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDealDetail } from "@/server/queries/deal";
import { getQueue, nextWaitingId } from "@/server/queries/queue";
import { LiveRefresh } from "@/components/shell/live";
import { LeadPanel } from "@/components/lead/lead-sheet";
import { QueueColumn } from "@/components/queue/queue-column";
import { BackToQueue } from "@/components/queue/queue-route";
import { isMobileUserAgent } from "@/lib/device";

export const metadata = { title: "Conversa" };

/**
 * A conversa de um lead, em qualquer largura. Esta rota nunca redireciona para outra largura (quem decide por largura é só o CSS), então não há ida e volta:
 * no desktop (≥ 1024 px) mostra os painéis (fila | conversa | cliente) com este lead aberto; no celular, a conversa em tela cheia com "Voltar para a fila".
 * Com User-Agent de celular não monta a lista (não vai aparecer), e a tela cheia vale mesmo com a janela larga.
 */
export default async function ConversaPage({ params }: PageProps<"/atendimento/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const withList = !isMobileUserAgent((await headers()).get("user-agent"));
  const [detail, nextId, queue] = await Promise.all([getDealDetail(id), nextWaitingId(user, id), withList ? getQueue(user, {}) : Promise.resolve(null)]);
  if (!detail) notFound();
  const cols = withList ? "lg:grid-rows-1 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]" : "xl:grid-cols-[minmax(0,1fr)_300px]";
  return (
    <main className={`h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh overflow-hidden grid grid-cols-1 grid-rows-[auto_minmax(0,1fr)] ${cols}`}>
      <LiveRefresh scopes={["queue"]} />
      {queue && <QueueColumn queue={queue} query="" view="todos" foco={null} filtro={null} q={null} fonte={null} onlyOwnLabel={false} selectedId={id} className="hidden lg:flex" />}
      <div className={`flex items-center px-3 h-12 border-b border-line bg-paper ${withList ? "lg:hidden" : ""}`}><BackToQueue /></div>
      <LeadPanel key={id} d={detail} nextId={nextId} />
    </main>
  );
}
