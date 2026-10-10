import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getQueue } from "@/server/queries/queue";
import { getDealDetail } from "@/server/queries/deal";
import { LiveRefresh } from "@/components/shell/live";
import { LeadPanel } from "@/components/lead/lead-sheet";
import { Empty } from "@/components/ui/empty";
import { QueueRestore, ViewportRedirect } from "@/components/queue/queue-route";
import { QueueColumn } from "@/components/queue/queue-column";
import { parseQueueFilter } from "@/lib/report-links";
import { parseQueueFoco, parseQueueView, queueQuery } from "@/lib/queue";
import { isMobileUserAgent } from "@/lib/device";

export const metadata = { title: "Atendimento" };

export default async function AtendimentoPage({ searchParams }: PageProps<"/atendimento">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && (sp[k] as string).trim() ? (sp[k] as string).trim().slice(0, 80) : null);
  const view = parseQueueView(sp.view);
  const filtro = parseQueueFilter(sp.filtro);
  const q = str("q"), dono = str("dono"), etapa = str("etapa"), fonte = str("fonte");
  const lead = str("lead");
  const leadId = lead && /^[0-9a-f-]{36}$/i.test(lead) ? lead : null;
  // Celular: a conversa é uma tela própria. Decide aqui, antes de carregar e montar o lead; o ViewportRedirect cobre o resto (janela estreita no desktop).
  if (leadId && isMobileUserAgent((await headers()).get("user-agent"))) redirect(`/atendimento/${leadId}`);
  const foco = parseQueueFoco(sp.foco);
  const [queue, detail] = await Promise.all([
    getQueue(user, { view, foco, q, filtro, dono, etapa, fonte }),
    leadId ? getDealDetail(leadId) : Promise.resolve(null),
  ]);
  const query = queueQuery({ view: str("view") ? view : null, foco, filtro, etapa, dono, fonte, q });
  // Depois de responder, o botão leva a quem espera há mais tempo (a fila já vem pela maior espera).
  const nextId = queue.sections.filter((s) => ["atrasados", "perto", "aguardando"].includes(s.key)).flatMap((s) => s.items).find((i) => i.dealId !== leadId)?.dealId ?? null;
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
      <QueueRestore hasParams={Object.keys(sp).length > 0} />
      <LiveRefresh scopes={["queue"]} />
      {leadId && <ViewportRedirect when="mobile" to={`/atendimento/${leadId}`} />}
      <QueueColumn queue={queue} query={query} view={view} foco={foco} filtro={filtro} q={q} fonte={fonte} onlyOwnLabel={user.role !== "gestor"} selectedId={leadId} />
      {detail && leadId ? (
        <div className="hidden lg:contents"><LeadPanel key={leadId} d={detail} nextId={nextId} /></div>
      ) : (
        <>
          <section aria-label="Conversa" className="hidden lg:grid place-items-center bg-paper-2/50"><Empty title="Escolha uma conversa">Use as setas para percorrer a fila e Enter para abrir. A conversa e os dados da cliente aparecem aqui.</Empty></section>
          <aside aria-label="Dados do cliente" className="hidden xl:grid place-items-center border-l border-line bg-paper-2/30 px-6 text-center text-sm text-muted">Os dados da cliente aparecem aqui.</aside>
        </>
      )}
    </main>
  );
}
