import { requireUser } from "@/server/auth/session";
import { getBoard, getOrigins } from "@/server/queries/board";
import { getDealDetail } from "@/server/queries/deal";
import { activeUsers } from "@/server/domain/deals";
import { Board } from "@/components/pipeline/board";
import { Toolbar } from "@/components/pipeline/toolbar";
import { LiveRefresh } from "@/components/shell/live";
import { LeadSheetPresence } from "@/components/lead/lead-sheet";
import { parseFunilFilter } from "@/lib/report-links";
import Link from "next/link";
import { isUuid } from "@/lib/uuid";
import { WorkspaceBar } from "@/components/queue/workspace-bar";

const FILTER_LABEL = { atrasados: "Leads atrasados", esperando: "Leads esperando resposta", parados: "Leads parados" } as const;

export const metadata = { title: "Quadro" };

export default async function FunilPage({ searchParams }: PageProps<"/funil">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const leadId = str("lead");
  const filtro = parseFunilFilter(sp.filtro);
  const [board, people, origins, detail] = await Promise.all([
    // O escopo é o da Fila: a atendente vê os leads dela e os sem dono (com filtro de relatório, só os dela); a gestão vê todos.
    getBoard({ ownerId: str("dono"), origin: str("origem"), q: str("q"), filtro, etapa: filtro ? str("etapa") : null, source: filtro ? str("fonte") : null }, user),
    activeUsers(), getOrigins(),
    isUuid(leadId) ? getDealDetail(leadId) : Promise.resolve(null),
  ]);
  const open = board.filter((s) => !["fechado", "perdido"].includes(s.kind)).reduce((n, s) => n + s.cards.length, 0);
  const waiting = board.flatMap((s) => s.cards).filter((c) => c.awaitingReplySince && c.id !== leadId)
    .sort((a, b) => (a.awaitingReplySince! < b.awaitingReplySince! ? -1 : 1));
  const nextId = waiting[0]?.id ?? null;
  return (
    <main>
      <WorkspaceBar current="quadro" journey={user.role === "gestor"} />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 lg:px-8 pt-5 pb-4">
        <p className="text-graphite text-base">{open} lead{open === 1 ? "" : "s"} em andamento</p>
        <div className="flex items-center gap-2"><Toolbar people={people} origins={origins} /></div>
      </div>
      {filtro && (
        <p className="mx-5 lg:mx-8 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
          <span className="rounded-full bg-gold-soft text-gold-ink px-3 py-1 font-medium">Mostrando: {FILTER_LABEL[filtro].toLowerCase()}{user.role !== "gestor" ? " (só os seus)" : ""}{str("fonte") ? ` · origem ${str("fonte")}` : ""}</span>
          <Link href="/funil" className="inline-flex items-center min-h-11 text-graphite underline underline-offset-2 hover:text-ink">Mostrar todos</Link>
        </p>
      )}
      <LiveRefresh scopes={["queue"]} />
      <Board stages={board} viewer={{ id: user.id, role: user.role }} />
      <LeadSheetPresence d={detail} nextId={nextId} viewer={{ id: user.id, role: user.role }} />
    </main>
  );
}
