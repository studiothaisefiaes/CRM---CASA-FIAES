"use client";
import { useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";

/**
 * Resumo do dia da gestão (R1). Depois das 19h (Salvador) é "Resumo do dia": aberto e em destaque. Antes disso é "Resumo até agora": uma barra
 * recolhida, para não competir com o que pede ação agora. O texto dá para copiar e colar no WhatsApp; os links levam à lista de cada número.
 */
export function DailySummary({ text, links, highlight, title }: { text: string; links: { label: string; href: string }[]; highlight: boolean; title: string }) {
  const [copied, setCopied] = useState(false);
  const [heading, ...lines] = text.split("\n");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sem permissão de área de transferência */ }
  }
  return (
    <motion.section aria-label={title} data-testid="resumo-do-dia" data-destaque={highlight ? "sim" : "nao"} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }}
      className={cn("rounded-[var(--radius-panel)] border", highlight ? "border-gold/40 bg-gold-soft" : "border-line bg-paper-2")}>
      <details open={highlight} className="group">
        <summary className={cn("flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-5 [&::-webkit-details-marker]:hidden", highlight ? "py-4 lg:px-6" : "py-1")}>
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className="inline-block text-gold-ink transition-transform group-open:rotate-90">›</span>
            <span className={cn("font-serif font-light leading-tight", highlight ? "text-[26px]" : "text-[18px]")}>{title}</span>
          </span>
          <span className="shrink-0 text-sm text-gold-ink group-open:hidden">Abrir</span>
        </summary>
        <div className="px-5 pb-5 lg:px-6">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-graphite first-letter:uppercase">{heading}</p>
            <button type="button" onClick={copy} aria-live="polite" className="-my-2 inline-flex min-h-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] px-3 text-sm text-gold-ink hover:bg-paper/70">
              {copied ? "Copiado" : "Copiar texto"}
            </button>
          </div>
          <ul className="mt-2 flex flex-col gap-1 text-[16px] leading-snug">
            {lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
          {links.length > 0 && (
            <nav aria-label="Atalhos do resumo" className="mt-3 flex flex-wrap gap-2">
              {links.map((l) => (
                <Link key={l.href} href={l.href} className="inline-flex min-h-11 items-center rounded-full border border-gold-ink/40 bg-paper px-4 text-sm font-medium text-gold-ink hover:bg-paper-2">{l.label}</Link>
              ))}
            </nav>
          )}
        </div>
      </details>
    </motion.section>
  );
}
