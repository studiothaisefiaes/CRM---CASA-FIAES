"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { IconSearch } from "@/components/icons";
import { Menu } from "@/components/ui/menu";
import { QUEUE_VIEWS, VIEW_LABEL, queueQuery, type QueueView } from "@/lib/queue";
import type { QueueCounts } from "@/server/queries/queue";

/** Busca (nome ou telefone) e as visões prontas. As duas trocam a URL; o servidor refaz a lista. */
export function QueueFilters({ view, q, counts }: { view: QueueView; q: string; counts: QueueCounts }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [text, setText] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = queueQuery(Object.fromEntries(next) as Record<string, string>);
    router.replace(qs ? `/atendimento?${qs}` : "/atendimento", { scroll: false });
  };
  const onText = (v: string) => {
    setText(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: v.trim() || null }), 300);
  };

  return (
    <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
      <label className="relative block">
        <span className="sr-only">Buscar por nome ou telefone</span>
        <IconSearch size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input type="search" value={text} onChange={(e) => onText(e.target.value)} placeholder="Buscar" autoComplete="off" enterKeyHint="search"
          className="w-full h-11 lg:h-9 pl-9 pr-3 rounded-[var(--radius-control)] border border-control bg-paper text-[16px] lg:text-sm placeholder:text-muted" />
      </label>
      <Menu label="Visão da fila" align="left" className="block w-full" triggerClassName="w-full h-11 lg:h-9 pl-3 pr-3 justify-between border border-control bg-paper text-ink text-[16px] lg:text-sm font-medium"
        trigger={<><span className="truncate">{VIEW_LABEL[view]} ({counts.views[view]})</span><span aria-hidden className="text-muted text-[10px]">▼</span></>}
        items={QUEUE_VIEWS.map((v) => ({ label: `${VIEW_LABEL[v]} (${counts.views[v]})`, current: v === view, onSelect: () => go({ view: v, filtro: null, etapa: null, dono: null, fonte: null }) }))} />
    </div>
  );
}
