import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getContact, type ContactDeal } from "@/server/queries/contact";
import { LiveRefresh } from "@/components/shell/live";
import { Badge } from "@/components/ui/badge";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { ContactTimeline } from "@/components/contacts/contact-timeline";
import { BackToClient, StartConversation } from "@/components/contacts/start-conversation";
import { IconArrowRight, IconInstagram, IconMail, IconPhone } from "@/components/icons";
import { buildTimeline } from "@/lib/contact-timeline";
import { formatBRL } from "@/lib/money";
import { dueLabel } from "@/lib/next-action";
import { formatPhoneClient } from "@/lib/phone-client";
import { leadHref } from "@/lib/lead-href";

export const metadata = { title: "Contato" };

const TZ = "America/Bahia";
const monthYear = (d: Date) => d.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: TZ });
const day = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });

function dealStatus(d: ContactDeal): { label: string; tone: "gold" | "ok" | "alert" | "neutral" } {
  if (d.archived) return { label: "Não é cliente", tone: "neutral" };
  if (d.stageKind === "fechado") return { label: "Venda fechada", tone: "ok" };
  if (d.stageKind === "perdido") return { label: "Perdido", tone: "alert" };
  return { label: d.stageName, tone: "gold" };
}

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-4 shadow-[var(--shadow-card)]";
const H2 = "font-serif text-xl font-light tracking-[-0.01em]";

export default async function ContatoPage({ params }: PageProps<"/contatos/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const gestor = user.role === "gestor";
  const data = await getContact(id, { withValues: gestor });
  if (!data) notFound();
  const { contact, deals } = data;
  const now = data.asOf;
  const name = contact.name?.trim() || formatPhoneClient(contact.phone);
  const current = deals.find((x) => x.open) ?? null;
  const next = current ? data.tasks.filter((t) => t.dealId === current.id && t.kind === "proxima_acao" && !t.doneAt).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0] ?? null : null;
  const lastDeal = deals.find((x) => !x.archived);
  const days = buildTimeline({
    now,
    messages: data.messages, events: data.events.map((e) => ({ ...e, createdAt: e.createdAt })), lookup: data.lookup,
    deals: deals.map((x) => ({ id: x.id, createdAt: x.createdAt, stageName: x.stageName })),
  });

  return (
    <main className="pb-12">
      <LiveRefresh scopes={["queue"]} />
      <div className="px-5 pt-5 lg:px-8 lg:pt-8">
        <Link href="/contatos" className="inline-flex min-h-11 items-center gap-1.5 text-sm text-graphite hover:text-ink lg:min-h-0"><IconArrowRight size={14} className="rotate-180" />Contatos</Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5 px-5 pb-6 pt-3 lg:px-8">
        <div className="flex min-w-0 items-start gap-4 lg:gap-5">
          <ContactAvatar contactId={contact.id} hasAvatar={contact.hasAvatar} name={name} size={72} className="mt-1 ring-2 ring-gold-soft" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-gold-ink"><span aria-hidden className="h-px w-6 bg-gold" />Ficha do contato</p>
            <h1 className="mt-1 break-words font-serif text-[30px] font-light leading-[1.08] tracking-[-0.015em] lg:text-[44px]">{name}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base text-graphite">
              <a href={`tel:${contact.phone}`} className="inline-flex min-h-8 items-center gap-1.5 tabular hover:text-ink"><IconPhone size={15} />{formatPhoneClient(contact.phone)}</a>
              {contact.email && <span className="inline-flex items-center gap-1.5 break-all"><IconMail size={15} />{contact.email}</span>}
              {contact.instagram && <span className="inline-flex items-center gap-1.5"><IconInstagram size={15} />{contact.instagram}</span>}
            </p>
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Etiquetas">
              {contact.ignored ? <li><Badge tone="alert">Não é cliente</Badge></li> : contact.isClient ? <li><Badge tone="ok">Cliente</Badge></li> : <li><Badge>Ainda não é cliente</Badge></li>}
              {current && <li><Badge tone="gold">Em atendimento · {current.stageName}</Badge></li>}
              {!current && !contact.ignored && <li><Badge>Sem lead aberto</Badge></li>}
              {current && !current.ownerName && <li><Badge>Sem dono</Badge></li>}
            </ul>
          </div>
        </div>
        {!contact.ignored && <StartConversation contactId={contact.id} hasOpenLead={!!current} className="w-full sm:w-auto" />}
      </header>

      <dl className="mx-5 mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4 lg:mx-8" aria-label="Resumo">
        {([
          ["Origem", data.origin],
          ["Cliente desde", contact.clientSince ? monthYear(contact.clientSince) : "—"],
          ["Último atendimento", contact.lastServiceAt ? day(contact.lastServiceAt) : "—"],
          ["No sistema desde", monthYear(contact.createdAt)],
        ] as const).map(([k, v]) => (
          <div key={k} className="bg-paper px-4 py-3">
            <dt className="text-xs text-muted">{k}</dt>
            <dd className="mt-0.5 text-base font-medium first-letter:uppercase">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 px-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <aside aria-label="Atendimento" className="order-first flex flex-col gap-4 lg:order-last">
          <section className={CARD} aria-labelledby="lead-atual">
            <h2 id="lead-atual" className={H2}>Lead atual</h2>
            {contact.ignored ? (
              <div className="mt-2">
                <p className="text-sm text-graphite">Este contato está como <strong className="font-semibold text-ink">Não é cliente</strong>. As mensagens ficam guardadas, mas não abrem lead nem alerta.</p>
                <div className="mt-3"><BackToClient contactId={contact.id} /></div>
              </div>
            ) : current ? (
              <div className="mt-2 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2"><Badge tone="gold">{current.stageName}</Badge><span className="text-sm text-graphite">{current.ownerName ? `Com ${current.ownerName.split(" ")[0]}` : "Sem dono"}</span></div>
                <p className="text-sm">
                  <span className="text-muted">Próxima ação: </span>
                  {next ? <span className={next.dueAt.getTime() < now ? "font-medium text-alert" : "font-medium"}>{next.title} <span className="font-normal text-graphite">· {next.dueAt.getTime() < now ? "atrasada, " : ""}{dueLabel(next.dueAt.getTime(), now)}</span></span> : <span className="text-graphite">nenhuma definida</span>}
                </p>
                <Link href={leadHref(current.id)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-gold-ink hover:underline underline-offset-4">Abrir na Fila<IconArrowRight size={14} /></Link>
              </div>
            ) : (
              <p className="mt-2 text-sm text-graphite">Nenhum lead em andamento{lastDeal ? ` — o último foi em ${day(lastDeal.createdAt)}` : ""}. Use <strong className="font-semibold text-ink">Iniciar conversa</strong> para abrir um.</p>
            )}
          </section>

          {gestor && data.values && (
            <section className={CARD} aria-labelledby="valores">
              <h2 id="valores" className={H2}>Valores</h2>
              <dl className="mt-2 grid grid-cols-2 gap-4">
                <div><dt className="text-xs text-muted">Vendas</dt><dd className="font-serif text-[32px] font-light leading-none tabular">{data.values.sales}</dd></div>
                <div><dt className="text-xs text-muted">Total gasto</dt><dd className="font-serif text-[32px] font-light leading-none tabular">{formatBRL(data.values.totalCents)}</dd></div>
              </dl>
            </section>
          )}

          <section className={CARD} aria-labelledby="leads">
            <h2 id="leads" className={H2}>Leads <span className="font-sans text-sm font-normal text-muted">({deals.length})</span></h2>
            {deals.length === 0 ? <p className="mt-2 text-sm text-graphite">Nenhum lead ainda.</p> : (
              <ul className="-mx-1 mt-2 divide-y divide-line/70">
                {deals.map((x) => {
                  const st = dealStatus(x);
                  const body = (
                    <>
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5"><Badge tone={st.tone}>{st.label}</Badge><span className="text-sm tabular text-graphite">{day(x.createdAt)}</span></span>
                        <span className="mt-1 block text-sm text-graphite">{x.sourceLabel}{x.ownerName ? ` · ${x.ownerName.split(" ")[0]}` : ""}{x.valueCents ? ` · ${formatBRL(x.valueCents)}` : ""}</span>
                      </span>
                      {!x.archived && <IconArrowRight size={14} className="shrink-0 text-muted" />}
                    </>
                  );
                  return (
                    <li key={x.id}>
                      {x.archived ? <div className="flex min-h-11 items-center justify-between gap-3 px-1 py-2.5">{body}</div>
                        : <Link href={leadHref(x.id)} className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] px-1 py-2.5 hover:bg-paper-2/60">{body}</Link>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {contact.notes && (
            <section className={CARD} aria-labelledby="notas"><h2 id="notas" className={H2}>Observações</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm text-graphite">{contact.notes}</p></section>
          )}
        </aside>

        <ContactTimeline days={days} messageTotal={data.messageTotal} messageShown={data.messages.length} />
      </div>
    </main>
  );
}
