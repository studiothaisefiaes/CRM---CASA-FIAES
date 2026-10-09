import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listContacts } from "@/server/queries/contacts";
import { PageHeader } from "@/components/page-header";
import { ImportButton } from "./import-button";
import { SearchBox } from "./search-box";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { formatPhoneClient } from "@/lib/phone-client";

export const metadata = { title: "Contatos" };

export default async function ContatosPage({ searchParams }: PageProps<"/contatos">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : null;
  const clientes = sp.clientes === "1";
  const page = Number(sp.p ?? 1) || 1;
  const data = await listContacts({ q, onlyClients: clientes, page });
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const qs = (p: number) => { const s = new URLSearchParams(); if (q) s.set("q", q); if (clientes) s.set("clientes", "1"); if (p > 1) s.set("p", String(p)); return s.size ? `?${s}` : ""; };
  return (
    <main className="pb-12">
      <PageHeader title="Contatos" subtitle={`${data.total.toLocaleString("pt-BR")} contato${data.total === 1 ? "" : "s"}`}
        actions={<><SearchBox initial={q ?? ""} /><Link href={clientes ? "/contatos" : "/contatos?clientes=1"} className={`h-9 px-3 inline-flex items-center rounded-[var(--radius-control)] border text-sm ${clientes ? "bg-ink text-paper border-ink" : "border-line-strong"}`}>Só clientes</Link>{user.role === "gestor" && <ImportButton />}</>} />
      <div className="px-5 lg:px-8">
        {data.rows.length === 0 ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-paper"><Empty title={q ? "Nada encontrado" : "Nenhum contato ainda"}>{q ? "Tente outro nome ou telefone." : "Os contatos aparecem quando alguém manda mensagem no WhatsApp, ou importando o histórico de clientes."}</Empty></div>
        ) : (
          <>
          <ul className="sm:hidden rounded-[var(--radius-panel)] border border-line bg-paper divide-y divide-line/70">
            {data.rows.map((c) => (
              <li key={c.id}>
                <Link href={c.lastDealId ? `/funil?lead=${c.lastDealId}` : `/contatos?q=${encodeURIComponent(c.phone)}`} className="flex items-center justify-between gap-3 px-4 py-3 active:bg-paper-2">
                  <span className="min-w-0"><span className="block font-medium truncate">{c.name ?? "Sem nome"}</span><span className="block text-sm text-muted tabular">{formatPhoneClient(c.phone)}</span></span>
                  {c.isClient ? <Badge tone="ok">Cliente</Badge> : <Badge>Lead</Badge>}
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden sm:block rounded-[var(--radius-panel)] border border-line bg-paper overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-left text-xs text-muted border-b border-line">
                <th className="font-medium px-5 py-3">Nome</th><th className="font-medium px-3">Telefone</th><th className="font-medium px-3">E-mail</th><th className="font-medium px-3">Situação</th><th className="font-medium px-3">Último atendimento</th><th className="font-medium px-3 text-right pr-5">Leads</th>
              </tr></thead>
              <tbody>
                {data.rows.map((c) => (
                  <tr key={c.id} className="relative border-b border-line/70 last:border-0 hover:bg-paper-2/60 transition-colors">
                    <td className="px-5 py-2.5 font-medium">{c.lastDealId ? <Link href={`/funil?lead=${c.lastDealId}`} className="hover:text-gold-ink after:absolute after:inset-0">{c.name ?? "Sem nome"}</Link> : (c.name ?? "Sem nome")}</td>
                    <td className="px-3 tabular text-graphite whitespace-nowrap">{formatPhoneClient(c.phone)}</td>
                    <td className="px-3 text-graphite truncate max-w-[220px]">{c.email ?? "—"}</td>
                    <td className="px-3">{c.isClient ? <Badge tone="ok">Cliente{c.clientSince ? ` desde ${new Date(c.clientSince).getFullYear()}` : ""}</Badge> : <Badge>Lead</Badge>}</td>
                    <td className="px-3 text-graphite">{c.lastServiceAt ? new Date(c.lastServiceAt).toLocaleDateString("pt-BR") : "—"}</td>
                    <td className="px-3 pr-5 text-right tabular">{c.deals}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
        {pages > 1 && (
          <nav className="flex items-center justify-between mt-4 text-sm" aria-label="Páginas">
            <span className="text-muted">Página {data.page} de {pages}</span>
            <div className="flex gap-2">
              {data.page > 1 && <Link href={`/contatos${qs(data.page - 1)}`} className="h-9 px-3 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong">Anterior</Link>}
              {data.page < pages && <Link href={`/contatos${qs(data.page + 1)}`} className="h-9 px-3 inline-flex items-center rounded-[var(--radius-control)] border border-line-strong">Próxima</Link>}
            </div>
          </nav>
        )}
      </div>
    </main>
  );
}
