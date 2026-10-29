import Link from "next/link";
import { originOptions } from "@/lib/origin-label";
import { can } from "@/lib/permissions";
import { requirePerm } from "@/server/auth/session";
import { contactFilterCounts, contactListOptions, contactTabCounts, listContacts } from "@/server/queries/contacts";
import { ClientTabs } from "@/components/contacts/client-tabs";
import { LiveRefresh } from "@/components/shell/live";
import { PageHeader } from "@/components/page-header";
import { NewClientButton } from "@/components/contacts/new-client";
import { SearchBox } from "./search-box";
import { ContactsList } from "@/components/contacts/contacts-list";
import { getMassSettings } from "@/server/domain/campaigns";
import { listTags } from "@/server/domain/tags";
import { ContactsFilterBar, CHIP } from "@/components/contacts/contacts-filters";
import { ContactsMoreMenu } from "@/components/contacts/contacts-more-menu";
import { QueueSelectionProvider, SelectToggle } from "@/components/queue/queue-selection";
import { Empty } from "@/components/ui/empty";
import { CONTACT_FILTERS, CONTACT_FILTER_HELP, CONTACT_FILTER_LABEL, CONTACT_SORTS, CONTACT_SORT_LABEL, contactListQuery, parseContactListParams } from "@/lib/contact-list-params";
import { displayName } from "@/lib/client-rhythm";
import { cn } from "@/lib/cn";
import { isFuncaoOn } from "@/server/domain/funcoes";
import { listDuplicateSuspects } from "@/server/queries/duplicate-suspects";
import { cached } from "@/server/queries/ttl-cache";
import { SIGNAL_LABEL } from "@/lib/merge-signals";
import { SectionTabs } from "@/components/shell/section-tabs";
import { clientesTabs } from "@/lib/section-tabs";
import { ClientesComPacote } from "@/components/contacts/packages-view";
import { LoyaltyOverviewView } from "@/components/contacts/loyalty-overview";
import { getLoyaltyOverview } from "@/server/queries/loyalty-view";

export const metadata = { title: "Clientes" };

const SELECT = "h-11 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-md sm:h-10 sm:text-sm";

export default async function ContatosPage({ searchParams }: PageProps<"/contatos">) {
  const user = await requirePerm("contatos.ver");
  const raw = await searchParams;
  const fidelidadeOn = await isFuncaoOn("fidelidade");
  const tabs = clientesTabs(user.perms, { fidelidadeOn });
  // Visões de Clientes (?vista=): Com pacote (atendimento.ver) e Fidelidade (função ligada). Sem acesso, cai na lista.
  const vista = raw.vista === "pacote" && tabs.some((t) => t.key === "pacote") ? "pacote" : raw.vista === "fidelidade" && fidelidadeOn ? "fidelidade" : null;
  if (vista) {
    const now = new Date();
    return (
      <main className="pb-12">
        <PageHeader title="Clientes" subtitle={vista === "pacote" ? "O andamento do pacote de cada cliente" : "Pontos e prêmios de cada cliente"}
          tabs={<SectionTabs label="Clientes" tabs={tabs} current={vista} />} />
        <div className="flex flex-col gap-5 px-5 lg:px-8">
          {vista === "pacote" ? <ClientesComPacote sp={raw} withValues={can(user.perms, "valores.ver")} now={now} /> : <LoyaltyOverviewView data={await getLoyaltyOverview()} />}
        </div>
      </main>
    );
  }
  const p = parseContactListParams(raw);
  // Possíveis duplicadas (Fase C, item 25a): só com a permissão de unir e a função ligada. Junto com as outras consultas (28/10: em fila, somava ~1 s).
  const dupOn = can(user.perms, "contatos.unir") && (await isFuncaoOn("unir"));
  // Contagens e opções valem por 60 s / 5 min (29/10, lentidão): a lista em si é sempre consultada na hora.
  const { now: _now, ...key } = p as typeof p & { now?: Date };
  const [data, counts, opts, tabCounts, suspects] = await Promise.all([listContacts(p),
    cached(`contatos:filtros:${JSON.stringify({ ...key, filter: null })}`, 60_000, () => contactFilterCounts({ ...p, filter: null })),
    cached("contatos:opcoes", 300_000, () => contactListOptions()),
    cached(`contatos:abas:${JSON.stringify(key)}`, 60_000, () => contactTabCounts(p)),
    dupOn ? cached("contatos:duplicadas", 60_000, () => listDuplicateSuspects()) : Promise.resolve([])]);
  // Mensagem em massa (Lote 5): só com a chave ligada em Configurações e a permissão.
  const massOn = can(user.perms, "mensagem.massa") && (await getMassSettings()).enabled;
  const tagNames = massOn ? (await listTags()).map((t) => t.name) : [];
  // O público da massa pelo cabeçalho só entende busca e "Só clientes": com outro filtro da lista, a massa vai pelos escolhidos (Selecionar).
  const massHeader = massOn && !(p.tab || p.filter || p.professionalId || p.service || p.tagId || p.origin || p.includeIgnored);
  const massSummary = [p.q ? `busca “${p.q}”` : null, p.onlyClients ? "só clientes" : null].filter(Boolean).join(" · ") || "todos os contatos";
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const href = (over: Parameters<typeof contactListQuery>[1]) => `/contatos${contactListQuery(p, { page: 1, ...over })}`;
  const canExport = can(user.perms, "relatorios.exportar");
  const showDup = dupOn && raw.duplicadas === "1";
  // Os filtros extras ficam em "Mais filtros" (abre quando algum está em uso), para a lista aparecer logo.
  const listFilterOn = !!(p.professionalId || p.service || p.tagId || p.origin || p.sort);
  const hasActive = !!(listFilterOn || p.filter);
  const keep = Object.fromEntries(new URLSearchParams(contactListQuery(p, { q: "", page: 1 }).slice(1)));
  return (
    <QueueSelectionProvider>
      <main className="pb-12">
        <LiveRefresh scopes={["queue"]} />
        <PageHeader title="Clientes" subtitle={`${data.total.toLocaleString("pt-BR")} contato${data.total === 1 ? "" : "s"}${p.q || p.filter ? " encontrado" + (data.total === 1 ? "" : "s") : ""}`}
          actions={<div className="flex items-center gap-2">
            <ContactsMoreMenu exportHref={canExport ? `/api/contatos/csv${contactListQuery(p, { page: 1 })}` : null} canImport={can(user.perms, "config.sistema")}
              mass={massHeader ? { audience: { q: p.q || null, onlyClients: p.onlyClients }, tags: tagNames, summary: massSummary } : null} />
            <NewClientButton />
          </div>}
          tabs={<SectionTabs label="Clientes" tabs={tabs} current="clientes" />} />
        <div className="px-5 lg:px-8">
          <ClientTabs current={p.tab} counts={tabCounts} hrefFor={(tab) => href({ tab })} />
          <div className="mb-3 flex items-center gap-2">
            <div className="min-w-0 flex-1 sm:flex-none"><SearchBox initial={p.q} keep={keep} /></div>
            <SelectToggle className="min-h-11 border border-line-strong sm:ml-auto sm:min-h-10" />
          </div>

          <ContactsFilterBar hasActive={hasActive} clearHref={href({ professionalId: null, service: null, tagId: null, origin: null, sort: null, filter: null })}
            // "Com pacote" tem uma porta só (r68 #12): a aba Clientes › Com pacote. O chip só aparece para quem não vê a aba.
            filters={CONTACT_FILTERS.filter((f) => f !== "com_pacote" || !tabs.some((t) => t.key === "pacote")).map((f) => ({ key: f, label: CONTACT_FILTER_LABEL[f], count: counts[f], href: href({ filter: p.filter === f ? null : f }), on: p.filter === f, help: CONTACT_FILTER_HELP[f] }))}
            toggles={[
              { key: "so", label: "Só clientes", href: href({ onlyClients: !p.onlyClients }), on: p.onlyClients },
              ...(dupOn && suspects.length > 0 ? [{ key: "dup", label: `Possíveis duplicadas (${suspects.length})`, href: showDup ? "/contatos" : "/contatos?duplicadas=1", on: showDup }] : []),
              { key: "ign", label: "Incluir “Não é cliente”", href: href({ includeIgnored: !p.includeIgnored }), on: p.includeIgnored },
            ]}>
            <form method="get" action="/contatos" className="flex flex-wrap items-end gap-2" aria-label="Filtrar e ordenar">
              {p.q && <input type="hidden" name="q" value={p.q} />}
              {p.filter && <input type="hidden" name="f" value={p.filter} />}
              {p.tab && <input type="hidden" name="aba" value={p.tab} />}
              {p.onlyClients && <input type="hidden" name="clientes" value="1" />}
              {p.includeIgnored && <input type="hidden" name="ignorados" value="1" />}
              <label className="flex flex-col gap-1 text-xs text-muted">Profissional
                <select name="pro" defaultValue={p.professionalId ?? ""} className={SELECT}><option value="">Qualquer</option>{opts.professionals.map((x) => <option key={x.id} value={x.id}>{displayName(x.name)}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Serviço
                <select name="svc" defaultValue={p.service ?? ""} className={SELECT}><option value="">Qualquer</option>{opts.services.map((s) => <option key={s} value={s}>{s}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Etiqueta
                <select name="tag" defaultValue={p.tagId ?? ""} className={SELECT}><option value="">Qualquer</option>{opts.tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Origem
                <select name="origem" defaultValue={p.origin ?? ""} className={SELECT}><option value="">Qualquer</option>{originOptions(opts.origins).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Ordenar por
                <select name="ordem" defaultValue={p.sort ?? ""} className={SELECT}><option value="">{p.q ? "Mais parecido" : CONTACT_SORT_LABEL.chegada}</option>{CONTACT_SORTS.filter((s) => s !== "chegada").map((s) => <option key={s} value={s}>{CONTACT_SORT_LABEL[s]}</option>)}</select>
              </label>
              <button type="submit" className={cn(CHIP, "border-ink bg-ink text-paper")}>Aplicar</button>
            </form>
          </ContactsFilterBar>

          {showDup && (
            <ul aria-label="Possíveis duplicadas" className="mb-4 divide-y divide-line rounded-[var(--radius-panel)] border border-line bg-paper">
              {suspects.map((d) => (
                <li key={`${d.aId}|${d.bId}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-medium">{d.aName ?? "Sem nome"} <span className="font-normal text-muted">({d.aHint})</span> e {d.bName ?? "Sem nome"} <span className="font-normal text-muted">({d.bHint})</span></p>
                    <p className="text-xs text-muted">{d.signals.map((x) => SIGNAL_LABEL[x]).join(" · ")}</p>
                  </div>
                  <Link href={`/contatos/${d.aId}/unir`} className={cn(CHIP, "border-line-strong hover:bg-paper-2")}>Unir…</Link>
                </li>
              ))}
            </ul>
          )}
          {data.rows.length === 0 ? (
            <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
              <Empty title={p.q || p.filter ? "Nada encontrado" : "Nenhum contato ainda"}
                action={p.q && !p.includeIgnored ? <Link href={href({ includeIgnored: true })} className="inline-flex min-h-11 items-center text-sm font-semibold text-gold-ink underline underline-offset-4">Buscar também em “Não é cliente”</Link> : undefined}>
                {p.q ? "Tente outro nome, telefone ou um trecho da conversa." : p.filter ? "Nenhum contato neste filtro agora." : "Os contatos aparecem quando alguém manda mensagem no WhatsApp, ou importando o histórico de clientes."}
              </Empty>
            </div>
          ) : <ContactsList rows={data.rows} term={p.q} tagOptions={opts.tags.map((t) => t.name)} canExport={canExport} mass={massOn ? { tags: tagNames } : null} />}
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Páginas">
              <span className="text-muted">Página {data.page} de {pages}</span>
              <div className="flex gap-2">
                {data.page > 1 && <Link href={href({ page: data.page - 1 })} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9">Anterior</Link>}
                {data.page < pages && <Link href={href({ page: data.page + 1 })} className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong px-3.5 sm:min-h-9">Próxima</Link>}
              </div>
            </nav>
          )}
        </div>
      </main>
    </QueueSelectionProvider>
  );
}
