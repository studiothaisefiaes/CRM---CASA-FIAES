"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import type { BulkOptions, QueueItem, QueueSection } from "@/server/queries/queue";
import { IconArrowRight } from "@/components/icons";
import { QueueList } from "./queue-list";
import { BulkBar } from "./bulk-bar";
import { SelectionAnnouncer, useQueueSelection } from "./queue-selection";
import { cn } from "@/lib/cn";
import { ConversationOpeningView } from "./conversation-opening";
import { readQueueState, rememberLead, useQueueState, useSavedQueueQuery } from "./use-queue-state";
import { DESKTOP, rememberItem, useCurrentLead, useOpenLead, usePrimeItems } from "./open-lead";

export { ViewportRedirect } from "./open-lead";

/**
 * `QueueList` ligada à rota. No celular o item é um link para /atendimento/ID. No desktop (≥ 1024 px) o clique abre a conversa
 * no painel do meio (`?lead=ID`) na hora, sem recarregar a página nem a lista, que mantém a rolagem. Clique com Ctrl/Cmd/botão do meio segue o link normal.
 */
export function QueueListRoute({ sections, query, selectedId, className, bulk }: { sections: QueueSection[]; query: string; selectedId?: string | null; className?: string; bulk?: BulkOptions }) {
  const router = useRouter();
  const { ref, onScroll, freeze } = useQueueState(query);
  // Celular: tocar troca a tela na hora (cabeçalho e última mensagem do item) enquanto a rota da conversa carrega.
  const [opening, setOpening] = useState<QueueItem | null>(null);
  const [navigating, startNav] = useTransition();
  const open = useOpenLead();
  const current = useCurrentLead(selectedId ?? null);
  usePrimeItems(sections);
  const selection = useQueueSelection();
  // Só vale a seleção do que ainda está na lista (um lead que saiu, por tempo real ou filtro, não entra na ação).
  const present = new Set(sections.flatMap((s) => s.items.map((i) => i.dealId)));
  const chosen = selection ? [...selection.selected].filter((id) => present.has(id)) : [];
  const onOpen = (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    rememberLead(item.dealId);
    rememberItem(item);
    e.preventDefault();
    if (!window.matchMedia(DESKTOP).matches) {
      freeze(); // a lista sai da tela, então a rolagem de agora é a que vale
      setOpening(item);
      startNav(() => router.push(`/atendimento/${item.dealId}`));
      return;
    }
    open(item.dealId, { query });
  };
  return (
    <>
      <QueueList sections={sections} selectedId={current} onOpen={onOpen} listRef={ref} onScroll={onScroll} className={className} selection={selection ?? undefined} />
      {selection && <SelectionAnnouncer count={chosen.length} />}
      {bulk && <BulkBar ids={chosen} options={bulk} openId={current} />}
      {navigating && opening && <div className="lg:hidden fixed inset-0 z-40"><ConversationOpeningView item={opening} /></div>}
    </>
  );
}

/**
 * Entrou em /atendimento sem parâmetros (pela barra lateral, por exemplo): volta aos filtros da última vez e, no desktop, à última conversa aberta.
 * Quem vem com filtro na URL (relatório, sino) não é mexido.
 */
export function QueueRestore({ hasParams }: { hasParams: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (hasParams) return;
    const saved = readQueueState();
    const qs = new URLSearchParams(saved.query);
    if (saved.lead && window.matchMedia(DESKTOP).matches) qs.set("lead", saved.lead);
    if (qs.size) router.replace(`/atendimento?${qs}`, { scroll: false });
  }, [hasParams, router]);
  return null;
}

/** "Voltar para a fila": devolve a pessoa à lista com os mesmos filtros (a rolagem volta pelo useQueueState). */
export function BackToQueue({ compact, className }: { compact?: boolean; className?: string }) {
  const saved = useSavedQueueQuery();
  return (
    <Link href={saved ? `/atendimento?${saved}` : "/atendimento"} aria-label="Voltar para a fila" title="Voltar para a fila"
      className={cn(compact ? "inline-grid shrink-0 place-items-center size-11 rounded-[var(--radius-control)] text-ink hover:bg-paper-2" : "inline-flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-[var(--radius-control)] text-sm font-medium text-ink hover:bg-paper-2", className)}>
      <IconArrowRight size={compact ? 20 : 15} className="rotate-180" aria-hidden />{compact ? null : "Voltar para a fila"}
    </Link>
  );
}
