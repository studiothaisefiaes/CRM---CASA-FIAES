import Link from "next/link";
import { cn } from "@/lib/cn";

type View = "fila" | "quadro" | "jornada";
const TABS: { value: View; label: string; href: string }[] = [
  { value: "fila", label: "Fila", href: "/atendimento" },
  { value: "quadro", label: "Quadro", href: "/funil" },
  { value: "jornada", label: "Jornada", href: "/jornada" },
];

/**
 * A barra de Atendimento: o título e as abas Fila | Quadro | Jornada, idênticos e no mesmo lugar nas três telas
 * (antes o seletor pulava da coluna da Fila para o canto direito do Quadro e da Jornada). É o único h1 dessas telas.
 * A Jornada só aparece para a gestão (`journey`).
 */
export function WorkspaceBar({ current, journey = false, className }: { current: View; journey?: boolean; className?: string }) {
  const tabs = journey ? TABS : TABS.filter((t) => t.value !== "jornada");
  return (
    <div className={cn("shrink-0 flex items-center gap-4 lg:gap-6 h-14 lg:h-16 px-4 lg:px-8 bg-paper border-b border-line", className)}>
      <h1 className="font-serif text-[22px] lg:text-[26px] leading-none font-light tracking-[-0.01em]">Atendimento</h1>
      <nav aria-label="Formas de ver os leads" className="flex items-center gap-1">
        {tabs.map((t) => {
          const on = t.value === current;
          return (
            <Link key={t.value} href={t.href} aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex items-center h-9 px-3.5 rounded-full border text-sm font-medium select-none transition-[background,color,border-color] duration-150 pointer-coarse:min-h-11",
                on ? "bg-ink text-paper border-ink" : "bg-paper text-graphite border-control hover:border-graphite hover:text-ink",
              )}>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
