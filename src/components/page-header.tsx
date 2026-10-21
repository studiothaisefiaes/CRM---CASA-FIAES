import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Cabeçalho único de página (dsgfix): título de página (32 px, peso 400), frase de apoio, a ação principal à direita e, logo abaixo,
 * as abas. Filtros e exportação vão em `toolbar`, numa linha própria abaixo do título e das abas (nunca na linha do título).
 * `inset={false}` tira o recuo lateral quando a moldura da página já tem (Configurações).
 */
export function PageHeader({ title, subtitle, actions, tabs, toolbar, back, inset = true, className }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; tabs?: ReactNode; toolbar?: ReactNode; back?: ReactNode; inset?: boolean; className?: string;
}) {
  return (
    <header className={cn(inset && "px-5 lg:px-8", "pt-6 pb-5 lg:pt-8", className)} data-page-header>
      {back && <div className="mb-1">{back}</div>}
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-normal leading-tight tracking-[-0.01em] text-ink">{title}</h1>
          {subtitle && <div className="mt-1 text-base text-graphite">{subtitle}</div>}
        </div>
        {actions && <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && <div className="mt-4">{tabs}</div>}
      {toolbar && <div className="mt-4 flex flex-wrap items-center gap-2" data-page-toolbar>{toolbar}</div>}
    </header>
  );
}

/** "‹ Lugar de cima": volta da página filha (Fechar caixa, Unir cadastros, item de Configurações). */
export function PageBack({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-graphite hover:text-ink lg:min-h-9">
      <span aria-hidden>‹</span> {children}
    </Link>
  );
}
