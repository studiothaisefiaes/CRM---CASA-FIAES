"use client";
import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";
import type { QueueItem, QueueSection } from "@/server/queries/queue";
import { IconArrowRight } from "@/components/icons";
import { QueueList } from "./queue-list";
import { readQueueState, rememberLead, useQueueState, useSavedQueueQuery } from "./use-queue-state";

const DESKTOP = "(min-width: 1024px)";

/**
 * `QueueList` ligada à rota. No celular o item é um link para /atendimento/ID. No desktop (≥ 1024 px) o clique abre a conversa
 * no painel do meio (`?lead=ID`) sem recarregar a lista, que mantém a rolagem. Clique com Ctrl/Cmd/botão do meio segue o link normal.
 */
export function QueueListRoute({ sections, query, selectedId, className }: { sections: QueueSection[]; query: string; selectedId?: string | null; className?: string }) {
  const router = useRouter();
  const { ref, onScroll, freeze } = useQueueState(query);
  const onOpen = (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    rememberLead(item.dealId);
    if (!window.matchMedia(DESKTOP).matches) { freeze(); return; } // celular: a lista sai da tela, então a rolagem de agora é a que vale
    e.preventDefault();
    const qs = new URLSearchParams(query);
    qs.set("lead", item.dealId);
    router.replace(`/atendimento?${qs}`, { scroll: false });
  };
  return <QueueList sections={sections} selectedId={selectedId} onOpen={onOpen} listRef={ref} onScroll={onScroll} className={className} />;
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

/** Leva a outra tela quando a janela é (ou passa a ser) de celular ou de desktop: /atendimento?lead=ID ↔ /atendimento/ID. */
export function ViewportRedirect({ to, when }: { to: string; when: "desktop" | "mobile" }) {
  const router = useRouter();
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const go = () => { if (mq.matches === (when === "desktop")) router.replace(to, { scroll: false }); };
    go();
    mq.addEventListener("change", go);
    return () => mq.removeEventListener("change", go);
  }, [to, when, router]);
  return null;
}

/** "Voltar para a fila": devolve a pessoa à lista com os mesmos filtros (a rolagem volta pelo useQueueState). */
export function BackToQueue() {
  const saved = useSavedQueueQuery();
  return (
    <Link href={saved ? `/atendimento?${saved}` : "/atendimento"} className="inline-flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-[var(--radius-control)] text-sm font-medium text-ink hover:bg-paper-2">
      <IconArrowRight size={15} className="rotate-180" aria-hidden />Voltar para a fila
    </Link>
  );
}
