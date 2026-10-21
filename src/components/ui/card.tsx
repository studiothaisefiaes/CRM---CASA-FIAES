import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Cartão padrão (dsgfix): papel branco, borda de linha, raio de cartão e sombra leve. `tone="quiet"` é o bloco cinza-papel sem borda
 * (informação de apoio); `tone="notice"` é o aviso bege. Vermelho-claro não é cartão: é só a faixa de alerta.
 */
export const cardClass = (tone: "default" | "quiet" | "notice" = "default", className?: string) =>
  cn("rounded-[var(--radius-card)]",
    tone === "default" && "border border-line bg-paper shadow-[var(--shadow-card)]",
    tone === "quiet" && "bg-paper-2",
    tone === "notice" && "bg-gold-soft",
    className);

export function Card({ tone = "default", title, action, className, children, ...rest }: HTMLAttributes<HTMLElement> & {
  tone?: "default" | "quiet" | "notice"; title?: ReactNode; action?: ReactNode;
}) {
  return (
    <section className={cardClass(tone, cn("p-5", className))} {...rest}>
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-lg font-semibold leading-tight text-ink">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
