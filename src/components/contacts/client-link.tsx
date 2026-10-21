"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { contactHref } from "@/lib/lead-href";
import { cn } from "@/lib/cn";

/**
 * Nome ou foto que abre a ficha da cliente (Lote 2). Pode ficar POR CIMA de uma linha que já é clicável (link esticado para a conversa):
 * `relative z-[1]` o põe acima do link da linha, e o toque não "vaza" para a linha nem começa o arrasto do Quadro.
 * Nunca colocar dentro de outro link (HTML inválido): a linha usa link esticado ao lado deste. `min-h-6`: alvo de 24 px quando vira bloco (WCAG 2.5.8).
 */
export function ClientLink({ contactId, name, children, className, label }: { contactId: string; name: string; children: ReactNode; className?: string; label?: string }) {
  return (
    <Link href={contactHref(contactId)} aria-label={label ?? `Ficha de ${name}`} title={`Ver ficha de ${name}`}
      onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      className={cn("relative z-[1] min-h-6 rounded-[var(--radius-control)] underline-offset-4 hover:underline", className)}>
      {children}
    </Link>
  );
}
