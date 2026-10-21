"use client";
import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { isFichaTab, type FichaTab } from "@/lib/ficha";
import { cn } from "@/lib/cn";

/**
 * As abas da ficha. A aba mora na URL (?aba=pacotes), trocada sem ir ao servidor (history.replaceState, que o Next acompanha):
 * atualizar a página, o tempo real e o selo "Pacote: 3 de 4" do topo caem na mesma aba. Todos os painéis vêm prontos do servidor; os outros ficam ocultos.
 */
function useFichaTab(money: boolean, consultoria = false): [FichaTab, (t: FichaTab) => void] {
  const sp = useSearchParams();
  const raw = sp.get("aba");
  const tab: FichaTab = isFichaTab(raw, money, consultoria) ? raw : "resumo";
  const go = (t: FichaTab) => {
    const url = new URL(window.location.href);
    if (t === "resumo") url.searchParams.delete("aba"); else url.searchParams.set("aba", t);
    window.history.replaceState(null, "", url); // null: com o estado interno do Next, ele acharia que a chamada é dele e não atualizaria useSearchParams
  };
  return [tab, go];
}

export function FichaTabs({ tabs, panels, money }: { tabs: { value: FichaTab; label: string; count?: number }[]; panels: Partial<Record<FichaTab, ReactNode>>; money: boolean }) {
  const [tab, go] = useFichaTab(money, tabs.some((t) => t.value === "consultoria"));
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (i: number) => { const n = (i + tabs.length) % tabs.length; go(tabs[n].value); refs.current[n]?.focus(); };
  const onKey = (e: KeyboardEvent, i: number) => {
    const k = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (k != null) { e.preventDefault(); move(k); }
  };
  return (
    <div className="min-w-0" id="ficha-abas">
      <div role="tablist" aria-label="Partes da ficha" className="-mx-5 flex gap-1 overflow-x-auto border-b border-line px-5 scroll-thin lg:mx-0 lg:px-0">
        {tabs.map((t, i) => {
          const on = t.value === tab;
          return (
            <button key={t.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`aba-${t.value}`} aria-controls={`painel-${t.value}`}
              aria-selected={on} tabIndex={on ? 0 : -1} onClick={() => go(t.value)} onKeyDown={(e) => onKey(e, i)}
              className={cn("-mb-px inline-flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 text-base transition-colors",
                on ? "border-ink font-semibold text-ink" : "border-transparent font-medium text-graphite hover:text-ink")}>
              {t.label}{t.count ? <span className="tabular text-xs font-medium text-muted">{t.count}</span> : null}
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div key={t.value} role="tabpanel" id={`painel-${t.value}`} aria-labelledby={`aba-${t.value}`} hidden={t.value !== tab} className="pt-5">
          {panels[t.value]}
        </div>
      ))}
    </div>
  );
}

/** Leva a uma aba da ficha (o selo do pacote, "Ver todos" dos cartões do Resumo). No celular, rola até as abas. */
export function GoToTab({ tab, money, className, children, label }: { tab: FichaTab; money: boolean; className?: string; children: ReactNode; label?: string }) {
  const [, go] = useFichaTab(money);
  return (
    <button type="button" aria-label={label} className={className}
      onClick={() => { go(tab); requestAnimationFrame(() => document.getElementById(`aba-${tab}`)?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" })); }}>
      {children}
    </button>
  );
}
