import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

type View = "fila" | "quadro" | "programadas";
const TABS: { value: View; label: string; href: string }[] = [
  { value: "fila", label: "Fila", href: "/atendimento" },
  { value: "quadro", label: "Quadro", href: "/funil" },
  { value: "programadas", label: "Programadas", href: "/atendimento/programadas" },
];

/**
 * A barra de Conversas: o título e as abas Fila | Quadro | Programadas, idênticos e no mesmo lugar nas telas de Conversas.
 * É o único h1 dessas telas. O Quadro só aparece para quem tem a permissão (`quadro`). A Jornada saiu daqui (17/10): fica em Relatórios.
 * `programadas`: quantas mensagens programadas há (o número ao lado da aba).
 */
export function WorkspaceBar({ current, quadro = false, programadas, className, action }: { current: View; quadro?: boolean; programadas?: number; className?: string; /** À direita (ex.: "Nova conversa" na Fila). */ action?: ReactNode }) {
  const tabs = TABS.filter((t) => (t.value === "quadro" ? quadro : true));
  return (
    <div className={cn("shrink-0 flex items-center gap-3 lg:gap-6 h-14 lg:h-16 px-4 lg:px-8 bg-paper border-b border-line", className)}>
      <h1 className="font-display text-[22px] lg:text-[26px] leading-none font-medium tracking-[-0.01em]">Conversas</h1>
      <nav aria-label="Formas de ver as conversas" className="flex items-center gap-1">
        {tabs.map((t) => {
          const on = t.value === current;
          return (
            <Link key={t.value} href={t.href} aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex items-center h-9 px-3 lg:px-3.5 rounded-full border text-sm font-medium select-none transition-[background,color,border-color] duration-150 pointer-coarse:min-h-11",
                on ? "bg-ink text-paper border-ink" : "bg-paper text-graphite border-control hover:border-graphite hover:text-ink",
              )}>
              {t.label}
              {t.value === "programadas" && programadas != null && <>{" "}<b className={cn("ml-1 font-semibold tabular max-lg:hidden", !on && "text-gold-ink")}>{programadas}</b></>}
            </Link>
          );
        })}
      </nav>
      {action}
    </div>
  );
}

/**
 * A mesma barra, compacta, no topo da coluna da Fila (desktop). 21/10 (dono): a faixa de cima comia altura da conversa,
 * que tem que ir até o alto da tela. O h1 continua lá, só para leitor de tela.
 */
export function WorkspaceTabsCompact({ current, quadro = false, programadas, action }: { current: View; quadro?: boolean; programadas?: number; action?: ReactNode }) {
  const tabs = TABS.filter((t) => (t.value === "quadro" ? quadro : true));
  return (
    <div className="flex items-center gap-1.5">
      <h1 className="sr-only">Conversas</h1>
      <nav aria-label="Formas de ver as conversas" className="flex min-w-0 items-center gap-1">
        {tabs.map((t) => {
          const on = t.value === current;
          return (
            <Link key={t.value} href={t.href} aria-current={on ? "page" : undefined}
              className={cn("inline-flex items-center h-8 px-2.5 rounded-full border text-[13px] font-medium select-none transition-[background,color,border-color] duration-150",
                on ? "bg-ink text-paper border-ink" : "bg-paper text-graphite border-control hover:border-graphite hover:text-ink")}>
              {t.label}
              {t.value === "programadas" && programadas != null && <b className={cn("ml-1 font-semibold tabular", !on && "text-gold-ink")}>{programadas}</b>}
            </Link>
          );
        })}
      </nav>
      {action}
    </div>
  );
}
