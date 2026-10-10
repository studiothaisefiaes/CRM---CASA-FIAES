import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDealDetail } from "@/server/queries/deal";
import { nextWaitingId } from "@/server/queries/queue";
import { LeadPanel } from "@/components/lead/lead-sheet";
import { BackToQueue, ViewportRedirect } from "@/components/queue/queue-route";
import { leadHref } from "@/lib/lead-href";

export const metadata = { title: "Conversa" };

/** No celular a Fila vem em sequência: lista → conversa → dados do cliente. No desktop esta rota volta para os 3 painéis. */
export default async function ConversaPage({ params }: PageProps<"/atendimento/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [detail, nextId] = await Promise.all([getDealDetail(id), nextWaitingId(user, id)]);
  if (!detail) notFound();
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh flex flex-col overflow-hidden">
      <ViewportRedirect when="desktop" to={leadHref(id)} />
      <div className="shrink-0 flex items-center px-3 h-12 border-b border-line bg-paper"><BackToQueue /></div>
      <div className="flex-1 min-h-0 grid grid-cols-1 grid-rows-[minmax(0,1fr)]">
        <LeadPanel key={id} d={detail} nextId={nextId} />
      </div>
    </main>
  );
}
