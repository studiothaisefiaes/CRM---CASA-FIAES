"use client";
import Link from "next/link";
import type { MouseEvent } from "react";
import { packageValidityText, prettyName, sessionsText } from "@/lib/services-view";
import { formatBRL } from "@/lib/money";
import { cn } from "@/lib/cn";
import type { PackageCard } from "@/server/domain/caixa/packages";

/** Aba Pacotes: o catálogo de pacotes em cartões (ativos; desativados no fim). Clicar no cartão abre o painel grande. */
export function PackageCards({ packages, onOpen }: { packages: PackageCard[]; onOpen: (id: string) => void }) {
  const on = packages.filter((p) => p.active), off = packages.filter((p) => !p.active);
  if (!packages.length) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-10 text-center">
        <p className="text-base text-ink">Nenhum pacote cadastrado.</p>
        <p className="mt-1 text-sm text-muted">Crie o primeiro em “Novo pacote”: o nome, quantas sessões e o preço.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {on.length > 0 && <Grid items={on} onOpen={onOpen} label="Pacotes à venda" />}
      {off.length > 0 && (
        <section aria-labelledby="pacotes-off" className="flex flex-col gap-2">
          <h2 id="pacotes-off" className="flex items-baseline gap-2 text-base font-semibold text-ink">Desativados<span className="text-sm font-normal text-muted tabular-nums">{off.length}</span></h2>
          <Grid items={off} onOpen={onOpen} />
        </section>
      )}
    </div>
  );
}

function Grid({ items, onOpen, label }: { items: PackageCard[]; onOpen: (id: string) => void; label?: string }) {
  return (
    <ul aria-label={label} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((p) => <li key={p.id} className="flex"><Card p={p} onOpen={() => onOpen(p.id)} /></li>)}
    </ul>
  );
}

function Card({ p, onOpen }: { p: PackageCard; onOpen: () => void }) {
  const id = `pk-${p.id}`;
  const rowClick = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest("a,button")) onOpen(); };
  return (
    <article aria-labelledby={id} onClick={rowClick}
      className={cn("flex w-full cursor-pointer flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-paper p-4 shadow-[var(--shadow-card)] transition-colors hover:border-line-strong",
        !p.active && "bg-paper-2/50 shadow-none")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold leading-snug"><button id={id} type="button" onClick={onOpen} className={cn("text-left", p.active ? "text-ink" : "text-muted")}>{p.name}</button></h3>
          <p className="mt-0.5 line-clamp-2 text-sm leading-snug text-muted">{p.serviceLabels.map(prettyName).join(" + ")}</p>
        </div>
        {!p.active && <span className="shrink-0 rounded-full bg-paper-3 px-2 py-0.5 text-xs font-medium text-graphite">Desativado</span>}
      </div>
      <div>
        <p className={cn("text-2xl font-semibold leading-none tabular-nums", p.priceCents == null || !p.active ? "text-muted" : "text-ink")}>{p.priceCents == null ? "Sem preço" : formatBRL(p.priceCents)}</p>
        <p className="mt-1.5 text-sm text-graphite tabular-nums">
          <span className="font-medium text-ink">{sessionsText(p.sessions)}</span>
          {p.priceCents != null && <> · <span>{formatBRL(Math.round(p.priceCents / p.sessions))} por sessão</span></>}
        </p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line/70 pt-3 text-sm">
        <span className="text-graphite">{packageValidityText(p.validityDays)}</span>
        {p.activeClients
          ? <Link href={`/contatos?vista=pacote&pacote=${p.id}`} className="font-medium text-gold-ink underline-offset-4 hover:underline">{p.activeClients} {p.activeClients === 1 ? "cliente" : "clientes"} com o pacote ativo</Link>
          : <span className="text-muted">Nenhuma cliente com o pacote ativo</span>}
      </div>
    </article>
  );
}
