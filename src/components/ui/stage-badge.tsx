import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";

/**
 * Etapa do funil com a cor que a gestão escolheu (Configurações › Horário, etapas e prazos): bolinha na cor, fundo clarinho da mesma cor, texto escuro (lê bem com qualquer cor).
 * Com `onClick` (Fila), o toque troca a etapa ali mesmo; continua um `span` (a linha da Fila já é a opção da lista, nada clicável dentro dela).
 */
export function StageBadge({ name, color, className, onClick, title }: { name: string; color?: string | null; className?: string; onClick?: (e: MouseEvent<HTMLSpanElement>) => void; title?: string }) {
  const c = /^#[0-9a-f]{6}$/i.test(color ?? "") ? color! : "#5c5c5c";
  return (
    <span data-etapa="" onClick={onClick} title={title}
      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-px text-xs font-medium text-ink-2", onClick && "relative cursor-pointer hover:brightness-95 before:absolute before:-inset-2 before:content-['']", className)}
      style={{ backgroundColor: `${c}1f`, boxShadow: `inset 0 0 0 1px ${c}59` }}>
      <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: c }} />
      {name}
    </span>
  );
}
