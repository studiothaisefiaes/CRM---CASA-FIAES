import type { AppointmentItem, ClientPackageItem, SaleHistoryItem } from "@/server/queries/avec";
import { Badge } from "@/components/ui/badge";
import { appointmentLine, brDay, groupHistory, packagePercent } from "@/lib/client-avec";
import { displayName } from "@/lib/client-rhythm";
import { validityLabel } from "@/lib/agenda";
import { orderPackages, type PackageSession } from "@/lib/ficha";
import { Empty } from "@/components/ui/empty";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/cn";
import { servicesLine } from "@/lib/package-purchases";
import { PurchaseServiceList } from "@/components/agenda/purchase-services";

/** O que veio do Avec (e da agenda) na ficha da cliente: próximos horários, pacotes e atendimentos/compras. Valores só com "ver valores" (o servidor nem manda). */

const CARD = "rounded-[var(--radius-card)] border border-line bg-paper p-4 shadow-[var(--shadow-card)]";
const H2 = "text-lg font-semibold tracking-[-0.01em]";
const STATUS: Partial<Record<AppointmentItem["status"], { label: string; tone: "ok" | "neutral" | "gold" }>> = {
  agendado: { label: "Agendado", tone: "neutral" },
  confirmado: { label: "Confirmado", tone: "ok" },
  compareceu: { label: "Atendida", tone: "ok" },
};
const HISTORY_DAYS_OPEN = 8;

export function UpcomingAppointments({ items, now }: { items: AppointmentItem[]; now: number }) {
  return (
    <section className={CARD} aria-labelledby="proximos-horarios">
      <h2 id="proximos-horarios" className={H2}>Próximos horários</h2>
      {items.length === 0 ? <p className="mt-2 text-sm text-graphite">Nenhum horário marcado.</p> : (
        <ul className="mt-1 divide-y divide-line" data-testid="proximos-horarios">
          {items.map((a) => {
            const st = STATUS[a.status];
            const pro = displayName(a.professionalName);
            return (
              <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0 text-sm">
                  <span className="block font-medium text-ink first-letter:uppercase">{appointmentLine({ startsAt: a.startsAt, serviceLabel: a.serviceLabel, professionalName: null }, now)}</span>
                  <span className="mt-0.5 block text-graphite">
                    {[pro ? `Com ${pro}` : "Profissional não informada", a.durationMin ? `${a.durationMin} min` : null, a.priceCents != null ? formatBRL(a.priceCents) : null].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {st && <Badge tone={st.tone} className="shrink-0">{st.label}</Badge>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** O selo de situação do pacote (mesmo visual da tela Pacotes). */
function PackagePill({ p }: { p: ClientPackageItem }) {
  const cls = "rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap";
  if (p.situation === "esgotado") return <span className={cn(cls, "bg-paper-3 text-muted")}>Sessões usadas</span>;
  if (p.situation === "vencido") return <span className={cn(cls, "bg-paper-3 text-muted")}>Vencido</span>;
  if (p.endingSoon) return <span className={cn(cls, "bg-ink text-paper")}>Falta 1 sessão</span>;
  if (p.expiringSoon) return <span className={cn(cls, "bg-paper-3 text-ink")}>Vence logo</span>;
  return <span className={cn(cls, "bg-ok-soft text-ok")}>Em uso</span>;
}

/** Um pacote (uma compra) da cliente: os serviços dela com o uso de cada um, barra "3 de 4 sessões usadas", validade ("vence em N dias"), compra (valor só com "ver valores") e as sessões usadas. */
export function PackageCard({ p, sessions, today, money }: { p: ClientPackageItem; sessions: PackageSession[]; today: string; money: boolean }) {
  const done = p.situation === "vencido" || p.situation === "esgotado";
  const pct = packagePercent(p.usedSessions, p.totalSessions);
  return (
    <li className={cn("flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border bg-paper p-4",
      p.endingSoon || p.expiringSoon ? "border-line-strong" : "border-line", done && "bg-paper-2/60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-base font-semibold text-ink">{p.packageName}</h3>
          {p.services.length < 2 && servicesLine(p) && <p className="text-sm text-graphite">{servicesLine(p)}</p>}
        </div>
        <PackagePill p={p} />
      </div>
      <PurchaseServiceList p={p} className="text-sm" />
      <div>
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
          <span><span className="font-semibold tabular">{p.usedSessions} de {p.totalSessions}</span><span className="text-graphite"> {p.totalSessions === 1 ? "sessão usada" : "sessões usadas"}</span></span>
          <span className={cn("text-xs tabular", p.endingSoon ? "font-semibold text-ink" : "font-medium text-muted")}>{p.remaining ? (p.remaining === 1 ? "falta 1" : `faltam ${p.remaining}`) : "nenhuma restante"}</span>
        </div>
        <div role="meter" aria-valuemin={0} aria-valuemax={p.totalSessions} aria-valuenow={Math.min(p.usedSessions, p.totalSessions)}
          aria-label={`${p.usedSessions} de ${p.totalSessions} sessões usadas`} className="h-2 overflow-hidden rounded-full bg-paper-3">
          <div className={cn("h-full rounded-full", done ? "bg-line-strong" : "bg-ink-2")} style={{ width: `${pct}%` }} />
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">Validade</dt>
          <dd className={cn(p.situation === "vencido" ? "text-alert" : p.expiringSoon ? "font-medium text-ink" : "text-ink")}>
            {p.validUntil ? <><span className="tabular">{brDay(p.validUntil)}</span><span className="block text-xs font-normal text-muted">{validityLabel(p.validUntil, today)}</span></> : <span className="text-muted">Sem validade</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Comprado em</dt>
          <dd className="text-ink">
            {p.purchasedOn ? <span className="tabular">{brDay(p.purchasedOn)}</span> : <span className="text-muted">Data não informada</span>}
            {money && p.priceCents != null && <span className="block text-xs tabular text-graphite">{formatBRL(p.priceCents)}</span>}
          </dd>
        </div>
      </dl>
      <div className="border-t border-line pt-2.5">
        <h4 className="text-xs font-semibold text-graphite">Sessões usadas</h4>
        {sessions.length === 0 ? <p className="mt-1 text-sm text-muted">Nenhuma sessão usada ainda{p.usedSessions > 0 ? " (o Avec não mandou as datas)" : ""}.</p> : (
          <ul aria-label={`Sessões usadas de ${p.packageName}`} className="mt-1 divide-y divide-line/70 text-sm">
            {sessions.map((x) => (
              <li key={x.id} className="grid grid-cols-[84px_minmax(0,1fr)] gap-x-3 py-1.5">
                <span className="tabular text-graphite">{brDay(x.day)}</span>
                <span className="min-w-0 break-words">{x.service} <span className="text-graphite">· {x.professional ? `Com ${x.professional}` : "Profissional não informada"}</span></span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** A aba Pacotes da ficha: em uso primeiro (cartões em grade), encerrados recolhidos. */
export function ClientPackages({ items, sessions, today, money }: { items: ClientPackageItem[]; sessions: Map<string, PackageSession[]>; today: string; money: boolean }) {
  const { open, closed } = orderPackages(items);
  if (!items.length) return <Empty title="Sem pacote">Quando ela comprar um pacote, ele aparece aqui com as sessões que já usou.</Empty>;
  const card = (p: ClientPackageItem) => <PackageCard key={p.id} p={p} sessions={sessions.get(p.id) ?? []} today={today} money={money} />;
  return (
    <section aria-labelledby="pacotes" className="flex flex-col gap-3">
      <h2 id="pacotes" className={H2}>Pacotes <span className="text-sm font-normal text-muted">({open.length} em uso)</span></h2>
      {open.length === 0 ? <p className="text-sm text-graphite">Nenhum pacote em uso.</p>
        : <ul className="grid gap-3 xl:grid-cols-2" data-testid="pacotes">{open.map(card)}</ul>}
      {closed.length > 0 && (
        <details className="border-t border-line pt-2">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-ink lg:min-h-9">Encerrados ({closed.length})</summary>
          <ul className="mt-2 grid gap-3 xl:grid-cols-2">{closed.map(card)}</ul>
        </details>
      )}
    </section>
  );
}

function HistoryDayBlock({ day, items, totalCents }: { day: string; items: SaleHistoryItem[]; totalCents: number | null }) {
  return (
    <div>
      <h3 className="flex items-baseline justify-between gap-3 py-1.5 text-xs font-semibold text-gold-ink">
        <span className="tabular">{brDay(day)}</span>
        {totalCents != null && <span className="tabular normal-case tracking-normal text-graphite">{formatBRL(totalCents)}</span>}
      </h3>
      <ul className="divide-y divide-line/70 rounded-[var(--radius-control)] border border-line bg-paper">
        {items.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
            <span className="min-w-0">
              <span className="block break-words font-medium text-ink">{i.qty > 1 ? `${i.qty}× ` : ""}{i.item}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-graphite">
                {i.professionalName ? `Com ${i.professionalName}` : "Profissional não informada"}
                {i.fromPackage && <Badge>Do pacote</Badge>}
                {i.kind === "produto" && <Badge>Produto</Badge>}
              </span>
            </span>
            {i.totalCents != null && <span className="shrink-0 tabular text-ink">{formatBRL(i.totalCents)}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Atendimentos e compras (comandas do Avec), por dia, do mais novo ao mais antigo. Os dias mais antigos ficam recolhidos. */
export function ClientHistory({ items, limit }: { items: SaleHistoryItem[]; limit: number }) {
  const days = groupHistory(items);
  const first = days.slice(0, HISTORY_DAYS_OPEN), rest = days.slice(HISTORY_DAYS_OPEN);
  return (
    <section aria-labelledby="atendimentos" className="mb-10 min-w-0">
      <h2 id="atendimentos" className="mb-3 text-lg font-semibold">Atendimentos e compras</h2>
      {days.length === 0 ? (
        <p className="rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-paper-2/40 px-4 py-6 text-center text-sm text-graphite">Nenhum atendimento ou compra registrado ainda.</p>
      ) : (
        <div className="space-y-4" data-testid="atendimentos">
          {first.map((d) => <HistoryDayBlock key={d.day} {...d} />)}
          {rest.length > 0 && (
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-gold-ink">Ver dias anteriores ({rest.length})</summary>
              <div className="mt-2 space-y-4">{rest.map((d) => <HistoryDayBlock key={d.day} {...d} />)}</div>
            </details>
          )}
          {items.length >= limit && <p className="text-xs text-muted">Mostrando os {limit} itens mais recentes. Os mais antigos continuam guardados.</p>}
        </div>
      )}
    </section>
  );
}
