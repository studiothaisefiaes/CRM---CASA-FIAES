"use client";
import Link from "next/link";
import { leadHref } from "@/lib/lead-href";
import { displayName } from "@/lib/display-name";
import type { Following } from "@/server/domain/follow";
import { PreviewRow, ResumoBloco } from "./resumo-bloco";

const WHEN = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });

/** Acompanhando: as conversas que a própria pessoa escolheu acompanhar (estrela no menu ⋯ da conversa), mesmo depois de resolvidas. */
export function AcompanhandoBloco({ items }: { items: Following[] }) {
  const row = (f: Following) => (
    <Link key={f.dealId} href={leadHref(f.dealId)} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
      <span className="min-w-0 break-words">{displayName(f.name)}</span>
      <span className="shrink-0 text-muted tabular">{f.waiting ? "Esperando a Casa" : f.lastAt ? WHEN.format(new Date(f.lastAt)).replace(", ", " ") : ""}</span>
    </Link>
  );
  return (
    <ResumoBloco id="acompanhando" title="Acompanhando" count={items.length || null} empty={!items.length} more="Ver todas"
      panel={items.length ? <ul className="divide-y divide-line/70">{items.map((f) => <li key={f.dealId}>{row(f)}</li>)}</ul> : <p className="text-sm text-muted">Você não acompanha nenhuma conversa. No menu ⋯ da conversa, toque em Acompanhar.</p>}>
      {!items.length && <p className="text-sm text-muted">Nenhuma conversa acompanhada.</p>}
      {items.slice(0, 3).map((f) => <PreviewRow key={f.dealId} left={displayName(f.name)} right={f.waiting ? "Esperando" : null} />)}
    </ResumoBloco>
  );
}
