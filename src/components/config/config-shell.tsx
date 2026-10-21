"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CONFIG_ITEMS, configGroups, defaultConfigGroup, matchConfigItem, type ConfigGroupId, type ConfigState } from "@/lib/config-tabs";
import { cn } from "@/lib/cn";
import { DangerGate } from "./danger-gate";
import { PageBack } from "@/components/page-header";

const isGroup = (v: string | null, ids: ConfigGroupId[]): v is ConfigGroupId => !!v && (ids as string[]).includes(v);

/** Grupo da página aberta: o do item; numa página antiga sem `parte`, o do primeiro item daquele caminho; no índice, o `?grupo=`. */
function useConfigPlace(perms: readonly string[]) {
  const path = usePathname();
  const sp = useSearchParams();
  const item = matchConfigItem(path, sp.toString());
  const ids = configGroups(perms).map((g) => g.id);
  const loose = item ? null : CONFIG_ITEMS.find((i) => i.href.split("?")[0] === path || i.also?.includes(path)) ?? null;
  const index = path === "/config";
  const grupo = sp.get("grupo");
  const group: ConfigGroupId | null = item?.group ?? loose?.group ?? (index ? (isGroup(grupo, ids) ? grupo : defaultConfigGroup(perms)) : null);
  return { item, group, index };
}

/**
 * Moldura de Configurações. No índice: os grupos numa coluna à esquerda (sem abas correndo para o lado) e os itens à direita.
 * Num item: a tela inteira para o formulário (como o painel grande), com "‹ Configurações · Grupo" para voltar, o nome, a frase do que faz
 * e o que muda para a equipe. Na Área de cuidado, o formulário só destrava com a confirmação em duas etapas.
 */
export function ConfigShell({ perms, hints, children }: { perms: string[]; hints: Partial<Record<ConfigGroupId, ConfigState>>; children: ReactNode }) {
  const { item, group, index } = useConfigPlace(perms);
  const groups = configGroups(perms);
  const g = groups.find((x) => x.id === group) ?? null;
  if (index) return (
    <main className="px-4 pb-14 pt-5 sm:px-5 lg:px-8 lg:pt-8">
      <div className="mx-auto grid max-w-[1480px] gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Grupos de configuração" className="max-lg:hidden">
          <div className="sticky top-6 flex flex-col gap-0.5">
            <p className="mb-2 px-3 text-xs font-semibold text-muted">Grupos</p>
            {groups.map((x) => {
              const on = x.id === group;
              const hint = hints[x.id] ?? { text: x.hint };
              return (
                <div key={x.id} className={cn(x.danger && "mt-3 border-t border-line pt-3")}>
                  <Link href={`/config?grupo=${x.id}`} aria-current={on ? "page" : undefined}
                    className={cn("flex min-h-12 flex-col justify-center rounded-[var(--radius-control)] px-3 py-2 transition-colors",
                      on ? "bg-paper shadow-[var(--shadow-card)] ring-1 ring-line" : "hover:bg-paper-2")}>
                    <span className={cn("text-base font-semibold", x.danger ? "text-graphite" : "text-ink")}>{x.label}</span>
                    <span className={cn("text-sm", hint.alert ? "font-semibold text-alert" : hint.on ? "text-ok" : "text-muted")}>{hint.text}</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </main>
  );
  return (
    <main className="px-4 pb-14 pt-4 sm:px-5 lg:px-8 lg:pt-6">
      {/* Página de um item (r68 #22): uma coluna de leitura centralizada (texto e formulário com a mesma largura), não 700 px colados à esquerda. */}
      <div className="mx-auto max-w-[920px]">
        <header className="mb-6">
          <PageBack href={g ? `/config?grupo=${g.id}` : "/config"}>Configurações{g ? ` · ${g.label}` : ""}</PageBack>
          <h1 className="mt-1 font-display text-2xl font-normal leading-tight tracking-[-0.01em]">{item?.label ?? g?.label ?? "Configurações"}</h1>
          {item && <p className="mt-1.5 text-base text-graphite">{item.description}</p>}
          {item?.sends && (
            <p role="note" className="mt-3 rounded-[var(--radius-control)] bg-gold-soft px-3.5 py-2.5 text-sm text-ink">
              <b className="font-semibold">Isto manda mensagem para cliente sem ninguém apertar enviar.</b> Para ligar, você confirma antes; desligar é na hora.
            </p>
          )}
          {item?.changes && !item.danger && <p className="mt-3 text-sm text-ink-2"><span className="font-semibold">O que muda para a equipe:</span> {item.changes}</p>}
        </header>
        {item?.danger ? <DangerGate key={item.id} risk={item.changes ?? ""}>{children}</DangerGate> : children}
      </div>
    </main>
  );
}
