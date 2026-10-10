"use client";
import { useState } from "react";
import Link from "next/link";
import { LEGEND } from "@/lib/report-legend";
import { Reveal } from "./bars";

/** R1: resumo do dia em texto (dá para copiar e colar no WhatsApp) com os links para as listas. Fica mais quente a partir das 19h. */
export function SummaryBlock({ text, links, highlight }: { text: string; links: { label: string; href: string }[]; highlight: boolean }) {
  const [copied, setCopied] = useState(false);
  const [title, ...lines] = text.split("\n");
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* sem permissão de área de transferência */ }
  }
  return (
    <Reveal className={`rounded-[var(--radius-panel)] px-5 py-5 lg:px-6 ${highlight ? "bg-gold-soft" : "bg-paper-2"}`}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-serif text-[22px] font-light leading-tight">{title}</h2>
        <button type="button" onClick={copy} className="shrink-0 inline-flex items-center justify-center min-h-11 px-3 -my-2 rounded-[var(--radius-control)] text-[13px] text-gold-ink hover:bg-paper/70" aria-live="polite">
          {copied ? "Copiado" : "Copiar texto"}
        </button>
      </div>
      <ul className="mt-2 flex flex-col gap-1 text-[16px] leading-snug">
        {lines.map((l, i) => <li key={i} className="pl-0">{l}</li>)}
      </ul>
      {links.length > 0 && (
        <nav aria-label="Atalhos do resumo" className="mt-3 flex flex-wrap gap-2">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="inline-flex items-center min-h-11 px-4 rounded-full border border-gold-ink/40 bg-paper text-[14px] font-medium text-gold-ink hover:bg-paper-2">{l.label}</Link>
          ))}
        </nav>
      )}
      <details className="group mt-1">
        <summary className="inline-flex items-center gap-1.5 min-h-11 cursor-pointer list-none text-[13px] text-gold-ink hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>›</span>Como é calculado
        </summary>
        <p className="text-[13px] leading-relaxed text-graphite max-w-[68ch] pb-2">{LEGEND.resumo}</p>
      </details>
    </Reveal>
  );
}
