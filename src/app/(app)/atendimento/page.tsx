import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { getQueue } from "@/server/queries/queue";
import { getDealDetail } from "@/server/queries/deal";
import { LiveRefresh } from "@/components/shell/live";
import { LeadPanel } from "@/components/lead/lead-sheet";
import { Empty } from "@/components/ui/empty";
import { QueueListRoute, QueueRestore, ViewportRedirect } from "@/components/queue/queue-route";
import { QueueSummary } from "@/components/queue/queue-summary";
import { QueueFilters } from "@/components/queue/queue-filters";
import { ViewSwitch } from "@/components/queue/view-switch";
import { FILTER_LABEL, parseQueueFilter } from "@/lib/report-links";
import { parseQueueView, queueQuery } from "@/lib/queue";

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
  const [queue, detail] = await Promise.all([
    getQueue(user, { view, q, filtro, dono, etapa, fonte }),
    leadId ? getDealDetail(leadId) : Promise.resolve(null),
  ]);
  const query = queueQuery({ view: str("view") ? view : null, filtro, etapa, dono, fonte, q });
  // Depois de responder, o botão leva a quem espera há mais tempo (a fila já vem pela maior espera).
  const nextId = queue.sections.filter((s) => ["atrasados", "perto", "aguardando"].includes(s.key)).flatMap((s) => s.items).find((i) => i.dealId !== leadId)?.dealId ?? null;
  return (
    <main className="h-[calc(100dvh-3.5rem-5rem)] lg:h-dvh overflow-hidden grid grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
      <QueueRestore hasParams={Object.keys(sp).length > 0} />
      <LiveRefresh scopes={["queue"]} />
      {leadId && <ViewportRedirect when="mobile" to={`/atendimento/${leadId}`} />}
      <section aria-label="Fila de atendimento" className="min-h-0 flex flex-col bg-paper lg:border-r border-line">
        <div className="shrink-0 px-4 pt-3 lg:pt-5 pb-3 border-b border-line">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h1 className="font-serif text-[28px] leading-none font-light tracking-[-0.01em]">Atendimento</h1>
            <ViewSwitch current="fila" />
          </div>
          <QueueSummary counts={queue.counts} view={view} filtro={filtro} />
          {filtro && (
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
              <span className="rounded-full bg-gold-soft text-gold-ink px-3 py-1 font-medium">Mostrando: {FILTER_LABEL[filtro].toLowerCase()}{user.role !== "gestor" ? " (só os seus)" : ""}{fonte ? ` · origem ${fonte}` : ""}</span>
              <Link href="/atendimento?view=todos" replace className="inline-flex items-center min-h-11 lg:min-h-8 text-graphite underline underline-offset-2 hover:text-ink">Mostrar todos</Link>
            </p>
          )}
          <QueueFilters view={view} q={q ?? ""} counts={queue.counts} />
        </div>
        <QueueListRoute sections={queue.sections} query={query} selectedId={leadId} className="flex-1" />
      </section>
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
