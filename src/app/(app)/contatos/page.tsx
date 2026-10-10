import Link from "next/link";
import { requireUser } from "@/server/auth/session";
import { listContacts } from "@/server/queries/contacts";
import { LiveRefresh } from "@/components/shell/live";
import { PageHeader } from "@/components/page-header";
import { ImportButton } from "./import-button";
import { SearchBox } from "./search-box";
import { ContactsList } from "@/components/contacts/contacts-list";
import { QueueSelectionProvider, SelectToggle } from "@/components/queue/queue-selection";
import { Empty } from "@/components/ui/empty";
import { cn } from "@/lib/cn";

export const metadata = { title: "Contatos" };

const CHIP = "inline-flex h-11 items-center rounded-[var(--radius-control)] border px-3.5 text-sm font-medium transition-colors sm:h-10";

export default async function ContatosPage({ searchParams }: PageProps<"/contatos">) {
  const user = await requireUser();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const clientes = sp.clientes === "1";
  const ignorados = sp.ignorados === "1";
  const page = Number(sp.p ?? 1) || 1;
  const data = await listContacts({ q, onlyClients: clientes, includeIgnored: ignorados, page });
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const href = (over: { clientes?: boolean; ignorados?: boolean; p?: number }) => {
    const s = new URLSearchParams();
    if (q) s.set("q", q);
    if (over.clientes ?? clientes) s.set("clientes", "1");
    if (over.ignorados ?? ignorados) s.set("ignorados", "1");
    if (over.p && over.p > 1) s.set("p", String(over.p));
    return s.size ? `/contatos?${s}` : "/contatos";
  };
  const keep: Record<string, string> = { ...(clientes ? { clientes: "1" } : {}), ...(ignorados ? { ignorados: "1" } : {}) };
  return (
    <QueueSelectionProvider>
      <main className="pb-12">
        <LiveRefresh scopes={["queue"]} />
        <PageHeader title="Contatos" subtitle={`${data.total.toLocaleString("pt-BR")} contato${data.total === 1 ? "" : "s"}${q ? " encontrado" + (data.total === 1 ? "" : "s") : ""}`}
          actions={user.role === "gestor" ? <ImportButton /> : undefined} />
        <div className="px-5 lg:px-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="order-1 min-w-0 flex-1 sm:flex-none"><SearchBox initial={q} keep={keep} /></div>
            <SelectToggle className="order-2 min-h-11 border border-line-strong sm:order-4 sm:ml-auto sm:min-h-10 lg:min-h-10" />
            <div className="order-3 flex w-full flex-wrap gap-2 sm:w-auto">
              <Link href={href({ clientes: !clientes })} aria-pressed={clientes} className={cn(CHIP, clientes ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-paper-2")}>Só clientes</Link>
              <Link href={href({ ignorados: !ignorados })} aria-pressed={ignorados} className={cn(CHIP, ignorados ? "border-ink bg-ink text-paper" : "border-line-strong hover:bg-paper-2")}>Incluir “Não é cliente”</Link>
            </div>
          </div>
          {data.rows.length === 0 ? (
            <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
              <Empty title={q ? "Nada encontrado" : "Nenhum contato ainda"}
                action={q && !ignorados ? <Link href={href({ ignorados: true })} className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline underline-offset-4">Buscar também em “Não é cliente”</Link> : undefined}>
                {q ? "Tente outro nome, telefone ou um trecho da conversa." : "Os contatos aparecem quando alguém manda mensagem no WhatsApp, ou importando o histórico de clientes."}
              </Empty>
            </div>
          ) : <ContactsList rows={data.rows} term={q} />}
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Páginas">
              <span className="text-muted">Página {data.page} de {pages}</span>
              <div className="flex gap-2">
                {data.page > 1 && <Link href={href({ p: data.page - 1 })} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9">Anterior</Link>}
                {data.page < pages && <Link href={href({ p: data.page + 1 })} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9">Próxima</Link>}
              </div>
            </nav>
          )}
        </div>
      </main>
    </QueueSelectionProvider>
  );
}
