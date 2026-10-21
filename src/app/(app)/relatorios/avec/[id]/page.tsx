import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePerm } from "@/server/auth/session";
import { getAvecReport } from "@/server/queries/avec";
import { linkAvecRows } from "@/server/queries/avec-links";
import { contactHref } from "@/lib/lead-href";
import { can, canSeeAvecReports } from "@/lib/permissions";
import { PageHeader } from "@/components/page-header";
import { Empty } from "@/components/ui/empty";
import { IconArrowRight } from "@/components/icons";
import { AvecTableSearch } from "@/components/relatorios-avec/table-search";
import { AvecDownloadButtons } from "@/components/relatorios-avec/download-buttons";
import { periodLabel } from "@/components/relatorios-avec/format";

export const metadata = { title: "Relatório do Avec" };

const TZ = "America/Bahia";
const PAGER = "inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9 hover:bg-paper-2";

/** Um relatório do Avec guardado: a tabela saneada, com busca em qualquer coluna e 50 linhas por página. */
export default async function RelatorioAvecPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requirePerm("relatorios.ver");
  if (!canSeeAvecReports(user.perms)) redirect("/relatorios?aviso=sem-permissao");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const page = Number(sp.p ?? 1) || 1;
  const r = await getAvecReport(id, { q, page });
  if (!r) notFound();
  const links = await linkAvecRows(r.columns, r.rows);
  const href = (p: number) => { const s = new URLSearchParams(); if (q) s.set("q", q); if (p > 1) s.set("p", String(p)); return s.size ? `/relatorios/avec/${id}?${s}` : `/relatorios/avec/${id}`; };
  const first = (r.page - 1) * r.pageSize + 1;
  const sent = new Date(r.importedAt).toLocaleString("pt-BR", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <main className="pb-16">
      <div className="px-5 pt-5 lg:px-8 lg:pt-8">
        <Link href="/relatorios/avec" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-graphite hover:text-ink lg:min-h-0"><IconArrowRight size={14} className="rotate-180" />Relatórios do Avec</Link>
      </div>
      <PageHeader title={r.title}
        subtitle={<>
          <span className="tabular">{periodLabel(r.dateFrom, r.dateTo)} · {r.rowCount.toLocaleString("pt-BR")} {r.rowCount === 1 ? "linha" : "linhas"}</span>
          <span className="block text-sm text-muted mt-1">{r.fileName} · enviado em {sent}{r.importedByName ? ` por ${r.importedByName}` : ""}</span>
        </>}
        actions={can(user.perms, "relatorios.exportar") ? <AvecDownloadButtons id={r.id} /> : undefined} />
      <div className="px-5 lg:px-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <AvecTableSearch initial={q} />
          {q && <p className="text-sm text-graphite" role="status">{r.total.toLocaleString("pt-BR")} {r.total === 1 ? "linha encontrada" : "linhas encontradas"}</p>}
        </div>
        {r.rows.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
            <Empty title={q ? "Nada encontrado" : "Relatório sem linhas"}>{q ? "Tente outro nome, data ou parte do texto." : "O arquivo veio só com o cabeçalho."}</Empty>
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto scroll-thin rounded-[var(--radius-card)] border border-line bg-paper">
            <table className="w-full border-collapse text-sm tabular">
              <thead>
                <tr>
                  <th scope="col" className="sticky top-0 z-[1] bg-paper-2 px-3 py-2 text-right text-xs font-semibold text-muted border-b border-line-strong">#</th>
                  {r.columns.map((c, i) => <th key={i} scope="col" className="sticky top-0 z-[1] bg-paper-2 px-3 py-2 text-left text-xs font-semibold text-muted whitespace-nowrap border-b border-line-strong">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0 hover:bg-paper-2/60">
                    <td className="px-3 py-2 text-right text-xs text-muted">{first + i}</td>
                    {r.columns.map((_, j) => {
                      const v = row[j] ?? "";
                      const id = j === links.clientCol ? links.contactIds[i] : null;
                      return (
                        <td key={j} title={v.length > 40 ? v : undefined} className="px-3 py-2 whitespace-nowrap max-w-[32ch] truncate">
                          {id ? <Link href={contactHref(id)} className="font-medium text-gold-ink underline-offset-4 hover:underline">{v}</Link> : v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {r.pages > 1 && (
          <nav className="mt-4 flex items-center justify-between gap-3 text-sm" aria-label="Páginas">
            <span className="text-muted">Linhas {first.toLocaleString("pt-BR")} a {(first + r.rows.length - 1).toLocaleString("pt-BR")} de {r.total.toLocaleString("pt-BR")} · página {r.page} de {r.pages}</span>
            <div className="flex gap-2">
              {r.page > 1 && <Link href={href(r.page - 1)} className={PAGER}>Anterior</Link>}
              {r.page < r.pages && <Link href={href(r.page + 1)} className={PAGER}>Próxima</Link>}
            </div>
          </nav>
        )}
      </div>
    </main>
  );
}
