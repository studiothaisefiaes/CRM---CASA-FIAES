import { requirePerm } from "@/server/auth/session";
import { can } from "@/lib/permissions";
import { getBoard, getOrigins } from "@/server/queries/board";
import { activeUsers } from "@/server/domain/deals";
import { Board } from "@/components/pipeline/board";
import { Toolbar } from "@/components/pipeline/toolbar";
import { LiveRefresh } from "@/components/shell/live";
import { parseFunilFilter } from "@/lib/report-links";
import Link from "next/link";
import { WorkspaceBar } from "@/components/queue/workspace-bar";

const FILTER_LABEL = { atrasados: "Conversas atrasadas", esperando: "Conversas esperando resposta", parados: "Conversas paradas" } as const;

export const metadata = { title: "Quadro" };

export default async function FunilPage({ searchParams }: PageProps<"/funil">) {
  const user = await requirePerm("quadro.ver");
  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : null);
  const filtro = parseFunilFilter(sp.filtro);
  // ?lead=ID abre a conversa no painel da Fila, que busca o lead sozinho (GET /api/conversa/ID): o servidor não monta o lead aqui.
  const [board, people, origins] = await Promise.all([
    // O escopo é o da Fila: a atendente vê os leads dela e os sem dono (com filtro de relatório, só os dela); a gestão vê todos.
    getBoard({ ownerId: str("dono"), origin: str("origem"), q: str("q"), filtro, etapa: filtro ? str("etapa") : null, source: filtro ? str("fonte") : null }, user),
    activeUsers(), getOrigins(),
  ]);
  const open = board.filter((s) => !["fechado", "perdido"].includes(s.kind)).reduce((n, s) => n + s.cards.length, 0);
  return (
    <main>
      <WorkspaceBar current="quadro" quadro />
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 lg:px-8 pt-5 pb-4">
        <p className="text-graphite text-base">{open} {open === 1 ? "conversa" : "conversas"} em andamento</p>
        <div className="flex items-center gap-2"><Toolbar people={people} origins={origins} /></div>
      </div>
      {filtro && (
        <p className="mx-5 lg:mx-8 mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
          <span className="rounded-full bg-gold-soft text-gold-ink px-3 py-1 font-medium">Mostrando: {FILTER_LABEL[filtro].toLowerCase()}{!can(user.perms, "atendimento.todas") ? " (só as suas)" : ""}{str("fonte") ? ` · origem ${str("fonte")}` : ""}</span>
          <Link href="/funil" className="inline-flex items-center min-h-11 text-graphite underline underline-offset-2 hover:text-ink">Mostrar todos</Link>
        </p>
      )}
      <LiveRefresh scopes={["queue"]} />
      <Board stages={board} viewer={{ id: user.id, perms: user.perms }} />
    </main>
  );
}
