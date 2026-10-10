import { requireUser } from "@/server/auth/session";
import { getBoard, getOrigins } from "@/server/queries/board";
import { getDealDetail } from "@/server/queries/deal";
import { activeUsers } from "@/server/domain/deals";
import { db } from "@/server/db";
import { lists } from "@/server/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/page-header";
import { Board } from "@/components/pipeline/board";
import { Toolbar } from "@/components/pipeline/toolbar";
import { LiveRefresh } from "@/components/shell/live";
import { LeadSheetPresence } from "@/components/lead/lead-sheet";
import { parseFunilFilter } from "@/lib/report-links";
import Link from "next/link";
import { ViewSwitch } from "@/components/queue/view-switch";

const FILTER_LABEL = { atrasados: "Leads atrasados", esperando: "Leads esperando resposta", parados: "Leads parados" } as const;

export const metadata = { title: "Quadro" };

export default async function FunilPage({ searchParams }: PageProps<"/funil">) {
  const user = await requireUser();
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const leadId = str("lead");
  const filtro = parseFunilFilter(sp.filtro);
  const [board, people, origins, lostReasons, detail] = await Promise.all([
    getBoard({
      // Vindo de um relatório (filtro): a atendente só enxerga os leads dela, como na tela de relatórios. Sem filtro, o Funil segue mostrando todos.
      ownerId: filtro && user.role !== "gestor" ? user.id : str("dono"), origin: str("origem"), q: str("q"), filtro, etapa: filtro ? str("etapa") : null, source: filtro ? str("fonte") : null,
    }),
    activeUsers(), getOrigins(),
    db.select({ id: lists.id, label: lists.label }).from(lists).where(and(eq(lists.kind, "lost_reason"), eq(lists.active, true))).orderBy(asc(lists.position)),
    leadId && /^[0-9a-f-]{36}$/.test(leadId) ? getDealDetail(leadId) : Promise.resolve(null),
  ]);
  const open = board.filter((s) => !["fechado", "perdido"].includes(s.kind)).reduce((n, s) => n + s.cards.length, 0);
  const waiting = board.flatMap((s) => s.cards).filter((c) => c.awaitingReplySince && c.id !== leadId)
    .sort((a, b) => (a.awaitingReplySince! < b.awaitingReplySince! ? -1 : 1));
  const nextId = waiting[0]?.id ?? null;
  return (
    <main>
      <PageHeader title="Quadro" subtitle={`${open} lead${open === 1 ? "" : "s"} em andamento`} actions={<><ViewSwitch current="quadro" /><Toolbar people={people} origins={origins} /></>} />
      {filtro && (
        <p className="mx-5 lg:mx-8 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
          <span className="rounded-full bg-gold-soft text-gold-ink px-3 py-1 font-medium">Mostrando: {FILTER_LABEL[filtro].toLowerCase()}{user.role !== "gestor" ? " (só os seus)" : ""}{str("fonte") ? ` · origem ${str("fonte")}` : ""}</span>
          <Link href="/funil" className="inline-flex items-center min-h-11 text-graphite underline underline-offset-2 hover:text-ink">Mostrar todos</Link>
        </p>
      )}
      <LiveRefresh scopes={["queue"]} />
      <Board stages={board} lostReasons={lostReasons} />
      <LeadSheetPresence d={detail} nextId={nextId} />
    </main>
  );
}
