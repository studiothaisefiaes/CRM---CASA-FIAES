import { can } from "@/lib/permissions";
import { listCashSessions } from "@/server/queries/caixa";
import { Empty } from "@/components/ui/empty";
import { money } from "@/lib/format";
import { PAY_LABEL } from "@/lib/comanda-math";
import { ReopenCashButton } from "@/components/caixa/reopen-cash-button";

const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

/**
 * Histórico de caixas (dentro de "Fechar caixa / dia"): quem abriu e fechou e a diferença de cada forma (QA r58, C-1). Reabrir é da gestão
 * (caixa.gerir), com motivo. Sem caixa.outros, só os próprios caixas (QA r58, I-10).
 */
export async function FechamentosHistorico({ user }: { user: { id: string; perms: readonly string[] } }) {
  const canReopen = can(user.perms, "caixa.gerir");
  const rows = await listCashSessions({ viewer: user, limit: 60 });
  // Um "Reabrir" só, no topo da seção (r68 #15); as linhas mostram só o que aconteceu. Os 5 últimos à vista, o resto em "Ver anteriores".
  const closed = rows.filter((r) => r.status === "fechado").map((r) => ({ id: r.id, ownerName: r.openedByName, label: `${DM.format(new Date(`${r.day}T12:00:00Z`))} · ${r.openedByName ?? "sem nome"}` }));
  const recent = rows.slice(0, 5), older = rows.slice(5);
  const table = (list: typeof rows) => (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-paper">
      <table className="w-full min-w-[560px] text-sm">
        <thead><tr className="text-left text-muted"><th className="px-4 py-2 font-medium">Dia</th><th className="font-medium">Abriu</th><th className="font-medium">Fechou</th><th className="font-medium">Diferença</th><th className="pr-4 font-medium">Aprovação</th></tr></thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id} className="border-t border-line/70">
              <td className="px-4 py-2 tabular">{DM.format(new Date(`${r.day}T12:00:00Z`))}</td>
              <td>{r.openedByName ?? "—"}</td>
              <td>{r.status === "aberto" ? <span className="text-muted">ainda aberto</span> : r.closedByName ?? "—"}</td>
              <td className={r.differences.length ? "font-semibold text-alert tabular" : "tabular"}>{r.status === "aberto" ? <span className="text-muted">ainda contando</span> : r.differenceCents == null ? "—"
                : r.differences.length ? r.differences.map((d) => <span key={d.method} className="block">{`${PAY_LABEL[d.method]} ${money(d.cents)}`}</span>) : money(0)}</td>
              <td className="pr-4 text-graphite">{r.approvedByName ?? (r.status === "aberto" ? "" : "—")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <section id="historico" aria-label="Histórico de fechamentos" className="mt-10">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Histórico de fechamentos</h2>
          <p className="text-sm text-muted">{can(user.perms, "caixa.outros") ? "Os últimos caixas, de cada pessoa" : "Os seus últimos caixas"}</p>
        </div>
        {canReopen && closed.length > 0 && <ReopenCashButton choices={closed} />}
      </header>
      {rows.length ? (
        <div className="flex flex-col gap-3">
          {table(recent)}
          {older.length > 0 && (
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-medium text-gold-ink [&::-webkit-details-marker]:hidden lg:min-h-9">
                <span aria-hidden className="transition-transform group-open:rotate-90">›</span> Ver anteriores ({older.length})
              </summary>
              <div className="mt-2">{table(older)}</div>
            </details>
          )}
        </div>
      ) : <Empty title="Nenhum caixa ainda">Cada pessoa abre o próprio caixa em Caixa › Abrir caixa.</Empty>}
    </section>
  );
}
