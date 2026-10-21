import Link from "next/link";
import type { ClientPackageItem, PackageFilter } from "@/server/queries/avec";
import { validityLabel } from "@/lib/agenda";
import { formatPhoneClient } from "@/lib/phone-client";
import { money } from "@/lib/format";
import { Empty } from "@/components/ui/empty";
import { IconSearch } from "@/components/icons";
import { cn } from "@/lib/cn";
import { displayName } from "@/lib/display-name";
import { servicesLine } from "@/lib/package-purchases";
import { PurchaseServiceList } from "./purchase-services";

export type PackageTab = NonNullable<PackageFilter["situacao"]>;
export const PACKAGE_TABS: { value: PackageTab; label: string }[] = [
  { value: "ativos", label: "Ativos" }, { value: "acabando", label: "Acabando" }, { value: "vencendo", label: "Vencem em 30 dias" },
  { value: "encerrados", label: "Encerrados" }, { value: "todos", label: "Todos" },
];

const PROXIMO = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/**
 * Aba Pacotes: quem tem pacote (uma compra por cartão, com o uso de cada serviço dela), sessões usadas/total em barra, validade, próximo horário marcado da cliente.
 * "Acabando" = falta 1 sessão; "Vence em 30 dias" = validade nos próximos 30 dias. Valor só para quem vê valores.
 */
export function PackagesList({ items, tab, q, today, withValues, hrefFor, searchAction = "/servicos", searchHidden = { aba: "clientes" }, pacoteHref }: {
  /** Clientes › Com pacote: cada cartão leva ao pacote em Serviços e pacotes ("Ver o pacote"). */ pacoteHref?: string;
  items: ClientPackageItem[]; tab: PackageTab; q: string; today: string; withValues: boolean; hrefFor: (over: { situacao?: PackageTab; q?: string }) => string;
  /** A busca (GET): hoje na aba Serviços › Clientes com pacote. */ searchAction?: string; searchHidden?: Record<string, string>;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Situação do pacote" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scroll-thin lg:mx-0 lg:px-0">
          {PACKAGE_TABS.map((t) => (
            <Link key={t.value} href={hrefFor({ situacao: t.value })} aria-current={tab === t.value ? "page" : undefined}
              className={cn("inline-flex h-11 shrink-0 items-center rounded-full border px-3.5 text-sm font-medium transition-colors sm:h-9",
                tab === t.value ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>{t.label}</Link>
          ))}
        </nav>
        <form action={searchAction} method="get" role="search" className="relative block w-full sm:w-72">
          {Object.entries(searchHidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {tab !== "ativos" && <input type="hidden" name="situacao" value={tab} />}
          <label className="sr-only" htmlFor="pacotes-q">Buscar cliente ou pacote</label>
          <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input id="pacotes-q" type="search" name="q" defaultValue={q} placeholder="Buscar cliente ou pacote" autoComplete="off" enterKeyHint="search"
            className="h-11 w-full rounded-[var(--radius-control)] border border-control bg-paper pl-10 pr-3 text-md outline-none focus:border-ink sm:h-10 sm:text-base" />
        </form>
      </div>

      {!items.length ? (
        <div className="rounded-[var(--radius-panel)] border border-line bg-paper">
          <Empty title={q ? "Nada encontrado" : "Nenhum pacote aqui"}>
            {q ? "Confira o nome ou limpe a busca." : "Quando uma cliente compra um pacote, ele aparece aqui com as sessões que faltam."}
          </Empty>
        </div>
      ) : (
        <ul className="grid gap-2.5 md:grid-cols-2 2xl:grid-cols-3" aria-label="Pacotes">
          {items.map((p) => {
            const done = p.situation === "vencido" || p.situation === "esgotado";
            const pct = p.totalSessions ? Math.min(100, Math.round((p.usedSessions / p.totalSessions) * 100)) : 0;
            const name = <span className="truncate text-base font-semibold">{displayName(p.clientName)}</span>;
            return (
              <li key={p.id} className={cn("flex flex-col gap-3 rounded-[var(--radius-panel)] border bg-paper p-4",
                p.endingSoon ? "border-alert/35" : p.expiringSoon ? "border-gold/50" : "border-line", done && "bg-paper-2/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {p.contactId ? <Link href={`/contatos/${p.contactId}`} className="flex min-w-0 hover:text-gold-ink">{name}</Link> : <span className="flex min-w-0">{name}</span>}
                    <p className="truncate text-sm text-graphite">{[p.packageName, p.services.length < 2 ? servicesLine(p) : null].filter(Boolean).join(" · ")}</p>
                    <PurchaseServiceList p={p} className="mt-0.5 text-xs" />
                    {p.phone && <p className="text-xs text-muted tabular">{formatPhoneClient(p.phone)}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {p.endingSoon && <span className="rounded-full bg-alert-soft px-2.5 py-0.5 text-xs font-semibold text-alert">Acabando</span>}
                    {p.expiringSoon && <span className="rounded-full bg-gold-soft px-2.5 py-0.5 text-xs font-semibold text-gold-ink">Vence em 30 dias</span>}
                    {p.situation === "esgotado" && <span className="rounded-full bg-paper-3 px-2.5 py-0.5 text-xs font-semibold text-muted">Sessões usadas</span>}
                    {p.situation === "vencido" && <span className="rounded-full bg-paper-3 px-2.5 py-0.5 text-xs font-semibold text-muted">Vencido</span>}
                  </div>
                </div>

                <div>
                  <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
                    <span><span className="font-semibold tabular">{p.usedSessions}</span><span className="text-graphite"> de {p.totalSessions} {p.totalSessions === 1 ? "sessão usada" : "sessões usadas"}</span></span>
                    <span className={cn("text-xs font-medium tabular", p.endingSoon ? "text-alert" : "text-muted")}>
                      {p.remaining ? `${p.remaining === 1 ? "falta 1" : `faltam ${p.remaining}`}` : "nenhuma restante"}
                    </span>
                  </div>
                  <div role="meter" aria-valuemin={0} aria-valuemax={p.totalSessions} aria-valuenow={Math.min(p.usedSessions, p.totalSessions)}
                    aria-label={`${p.usedSessions} de ${p.totalSessions} sessões usadas`} className="h-2 overflow-hidden rounded-full bg-paper-3">
                    <div className={cn("h-full rounded-full", done ? "bg-line-strong" : p.endingSoon ? "bg-alert" : "bg-gold")} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 text-sm">
                  <div>
                    <dt className="text-xs text-muted">Validade</dt>
                    <dd className={cn(p.expiringSoon ? "font-medium text-gold-ink" : p.situation === "vencido" ? "text-alert" : "text-ink")}>
                      {p.validUntil ? <>{dmy(p.validUntil)} <span className="block text-xs font-normal text-muted">{validityLabel(p.validUntil, today)}</span></> : <span className="text-muted">Sem validade</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted">Próximo horário</dt>
                    <dd>{p.nextAppointmentAt ? <span className="tabular">{PROXIMO.format(new Date(p.nextAppointmentAt)).replace(",", "").replace(".", "")}</span>
                      : <span className="text-muted">Nenhum marcado</span>}</dd>
                  </div>
                </dl>
                {pacoteHref && <Link href={pacoteHref} className="inline-flex min-h-11 items-center self-start text-sm font-medium text-gold-ink underline-offset-4 hover:underline">Ver o pacote</Link>}
                {(withValues && p.priceCents != null) || p.purchasedOn ? (
                  <p className="border-t border-line pt-2.5 text-xs text-muted">
                    {[p.purchasedOn ? `Comprado em ${dmy(p.purchasedOn)}` : null, withValues && p.priceCents != null ? money(p.priceCents) : null].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
