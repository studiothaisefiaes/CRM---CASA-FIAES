"use client";
import Link from "next/link";
import { useState } from "react";
import { CONFIG_GROUPS, configGroups, configTabs, itemHref, searchConfig, type ConfigGroupId, type ConfigState } from "@/lib/config-tabs";
import { IconSearch, IconClose } from "@/components/icons";
import { cn } from "@/lib/cn";
import { ConfigStatePill } from "./config-state";

type Row = { id: string; group: ConfigGroupId; href: string; label: string; description: string; keywords: string[]; state: ConfigState | null; danger?: boolean };

function ItemRow({ r, showGroup }: { r: Row; showGroup?: boolean }) {
  return (
    <li className="border-b border-line/80 last:border-0">
      <Link href={r.href} className={cn("group flex min-h-[72px] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-paper-2/70 sm:px-5", r.danger && "text-graphite")}>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-4">
          <span className="min-w-0 flex-1">
            {showGroup && <span className="block text-xs font-semibold text-muted">{CONFIG_GROUPS.find((g) => g.id === r.group)?.label}</span>}
            <span className={cn("block text-base font-semibold group-hover:underline group-hover:underline-offset-4", r.danger ? "text-ink-2" : "text-ink")}>{r.label}</span>
            <span className="mt-0.5 block text-sm text-graphite">{r.description}</span>
          </span>
          {r.state && <ConfigStatePill state={r.state} className="self-start sm:self-center" />}
        </span>
        <span aria-hidden className="text-xl leading-none text-muted">›</span>
      </Link>
    </li>
  );
}

/**
 * Índice de Configurações: a busca no topo e os itens do grupo escolhido, cada um com nome, a frase do que faz e o estado.
 * No celular, o grupo se escolhe numa lista que abre para baixo (nada corre para o lado).
 */
export function ConfigIndex({ perms, group, states }: { perms: string[]; group: ConfigGroupId; states: Record<string, ConfigState | null> }) {
  const [q, setQ] = useState("");
  const groups = configGroups(perms);
  const rows: Row[] = configTabs(perms).map((i) => ({ id: i.id, group: i.group, href: itemHref(i, perms), label: i.label, description: i.description, keywords: i.keywords, state: states[i.id] ?? null, danger: i.danger }));
  const g = groups.find((x) => x.id === group) ?? groups[0];
  const found = q.trim() ? searchConfig(rows, q) : null;
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="font-display text-2xl font-normal leading-tight tracking-[-0.01em]">Configurações</h1>
        <p className="mt-1 text-base text-graphite">Escolha um grupo ou procure pelo nome, como lembrete, horário, etapa ou WhatsApp.</p>
      </header>
      <div role="search" className="flex h-12 items-center gap-2.5 rounded-[12px] border border-control bg-paper pl-3.5 pr-1.5 focus-within:border-ink focus-within:shadow-[0_0_0_3px_rgb(184_134_63/0.22)]">
        <IconSearch size={18} className="shrink-0 text-graphite" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Procurar configuração" placeholder="O que você quer mudar?"
          className="h-full min-w-0 flex-1 bg-transparent text-md md:text-base text-ink placeholder:text-muted focus:outline-none focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden" />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Limpar busca" className="grid size-11 place-items-center rounded-[var(--radius-control)] text-graphite hover:bg-paper-2 lg:size-10"><IconClose size={16} /></button>}
      </div>

      {found ? (
        found.length ? (
          <section aria-label="Resultado da busca">
            <p className="mb-2 text-sm text-graphite" role="status">{found.length === 1 ? "1 configuração" : `${found.length} configurações`} com “{q.trim()}”</p>
            <ul className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-paper shadow-[var(--shadow-card)]">
              {found.map((r) => <ItemRow key={r.id} r={r} showGroup />)}
            </ul>
          </section>
        ) : (
          <div className="rounded-[var(--radius-card)] border border-line bg-paper px-5 py-8 text-center" role="status">
            <p className="font-semibold">Nada com “{q.trim()}”.</p>
            <p className="mt-1 text-sm text-graphite">Tente outra palavra, como lembrete, horário, etapa ou WhatsApp.</p>
            <button type="button" onClick={() => setQ("")} className="mt-3 min-h-11 rounded-[var(--radius-control)] border border-line-strong px-4 text-sm font-medium hover:bg-paper-2">Limpar busca</button>
          </div>
        )
      ) : g ? (
        <>
          <details key={g.id} className="group/grupo rounded-[12px] border border-line-strong bg-paper lg:hidden">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-2 px-4 [&::-webkit-details-marker]:hidden">
              <span className="text-sm text-graphite">Grupo</span>
              <span className="flex-1 font-semibold">{g.label}</span>
              <span aria-hidden className="text-graphite transition-transform group-open/grupo:rotate-180">▾</span>
            </summary>
            <ul className="border-t border-line p-1.5">
              {groups.map((x) => (
                <li key={x.id} className={cn(x.danger && "mt-1 border-t border-line pt-1")}>
                  <Link href={`/config?grupo=${x.id}`} aria-current={x.id === g.id ? "page" : undefined}
                    className={cn("flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-base", x.id === g.id ? "bg-paper-3 font-semibold" : "hover:bg-paper-2", x.danger && "text-graphite")}>{x.label}</Link>
                </li>
              ))}
            </ul>
          </details>
          <section aria-labelledby="grupo-titulo" className="flex flex-col gap-3">
            <div>
              <h2 id="grupo-titulo" className={cn("text-lg font-semibold tracking-[-0.01em]", g.danger && "text-ink-2")}>{g.label}</h2>
              <p className="mt-0.5 text-sm text-graphite">{g.description}</p>
            </div>
            {g.id === "mensagens" && (
              <p role="note" className="rounded-[var(--radius-control)] bg-gold-soft px-3.5 py-2.5 text-sm text-ink">
                Tudo aqui pode mandar mensagem para cliente sem ninguém apertar enviar. Para ligar, você vê o aviso e confirma. Desligar é na hora.
              </p>
            )}
            {g.danger && (
              <p role="note" className="rounded-[var(--radius-control)] border border-alert/30 bg-alert-soft/60 px-3.5 py-2.5 text-sm text-ink">
                Mexer aqui pode parar o atendimento. Você pode ver como está; para mudar, precisa confirmar em duas etapas.
              </p>
            )}
            <ul className={cn("overflow-hidden rounded-[var(--radius-card)] border border-line shadow-[var(--shadow-card)]", g.danger ? "bg-paper-2/60" : "bg-paper")}>
              {rows.filter((r) => r.group === g.id).map((r) => <ItemRow key={r.id} r={r} />)}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}
