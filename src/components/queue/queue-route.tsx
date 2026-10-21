"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MouseEvent } from "react";
import type { BulkOptions, QueueItem, QueueSection } from "@/server/queries/queue";
import { IconArrowRight } from "@/components/icons";
import { QueueList } from "./queue-list";
import { PeopleFound } from "./people-found";
import { Empty } from "@/components/ui/empty";
import { StageQuickMenu, type StageTarget } from "./stage-quick-menu";
import { ContactKindPopover, useMarkContact } from "./contact-kind-menu";
import { displayName } from "@/lib/display-name";
import { formatPhoneClient } from "@/lib/phone-client";
import { BulkBar } from "./bulk-bar";
import { SelectionAnnouncer, useQueueSelection } from "./queue-selection";
import { cn } from "@/lib/cn";
import { ConversationOpeningView } from "./conversation-opening";
import { readQueueState, rememberLead, useQueueState, useSavedQueueQuery } from "./use-queue-state";
import { boardHref, DESKTOP, rememberItem, useCurrentLead, useOpenLead, usePrimeItems } from "./open-lead";
import { prefetchConversation } from "./conversation-cache";
import { useConversationCacheLive } from "./use-conversation-cache-live";

/** Depois que a Fila aparece, as primeiras conversas já vêm buscadas (desktop; uma vez por tela, sem martelar o servidor). */
const PREFETCH_FIRST = 8;
const PREFETCH_DELAY_MS = 1200;

export { ViewportRedirect } from "./open-lead";

/**
 * `QueueList` ligada à rota. No celular o item é um link para /atendimento/ID. No desktop (≥ 1024 px) o clique abre a conversa
 * no painel do meio (`?lead=ID`) na hora, sem recarregar a página nem a lista, que mantém a rolagem. Clique com Ctrl/Cmd/botão do meio segue o link normal.
 */
export function QueueListRoute({ sections, query, selectedId, className, bulk, expected = null }: { sections: QueueSection[]; query: string; selectedId?: string | null; className?: string; bulk?: BulkOptions;
  /** Quantas a aba diz ter (sem outros filtros): se a lista vier com bem menos, recarrega uma vez (20/10: "Todas 210" com 1 conversa na tela). */ expected?: number | null }) {
  const router = useRouter();
  const { ref, onScroll, freeze } = useQueueState(query);
  const shownCount = sections.reduce((n, s) => n + s.items.length, 0);
  const healed = useRef<string | null>(null);
  useEffect(() => {
    if (expected == null || shownCount >= Math.min(expected, 5) || healed.current === query) return;
    const t = setTimeout(() => { healed.current = query; router.refresh(); }, 1500);
    return () => clearTimeout(t);
  }, [expected, shownCount, query, router]);
  // Celular: tocar troca a tela na hora (cabeçalho e última mensagem do item) enquanto a rota da conversa carrega.
  const [opening, setOpening] = useState<QueueItem | null>(null);
  const [navigating, startNav] = useTransition();
  const open = useOpenLead();
  const current = useCurrentLead(selectedId ?? null);
  usePrimeItems(sections);
  useConversationCacheLive();
  const firstIds = sections.flatMap((s) => s.items).slice(0, PREFETCH_FIRST).map((i) => i.dealId).join(",");
  const prefetched = useRef(false);
  useEffect(() => {
    if (prefetched.current || !firstIds || !window.matchMedia(DESKTOP).matches) return;
    // Espera a tela assentar (fotos, primeira conversa) e pede da última para a primeira: a fila da pré-busca atende a mais recente antes.
    const t = setTimeout(() => { prefetched.current = true; for (const id of firstIds.split(",").reverse()) prefetchConversation(id); }, PREFETCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [firstIds]);
  const selection = useQueueSelection();
  // Etiqueta da etapa na linha: o toque abre o menu das etapas e a troca acontece ali mesmo.
  const [stageFor, setStageFor] = useState<StageTarget | null>(null);
  const onStageTap = (item: QueueItem) => setStageFor({ dealId: item.dealId, stageKey: item.stageKey, name: item.name === item.phone ? formatPhoneClient(item.phone) : displayName(item.name) });
  // Botão direito (ou toque longo) na linha: "Marcar como…" Cliente, Equipe, Fornecedor, Spam (17/10).
  const [kindFor, setKindFor] = useState<{ item: QueueItem; at: { x: number; y: number } } | null>(null);
  const { mark } = useMarkContact(() => router.refresh());
  const closeKind = useCallback(() => setKindFor(null), []);
  const kindName = kindFor ? (kindFor.item.name === kindFor.item.phone ? formatPhoneClient(kindFor.item.phone) : displayName(kindFor.item.name)) : "";
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
      prefetchConversation(item.dealId); // a conversa vem junto com a tela nova do servidor, não depois
      setOpening(item);
      startNav(() => router.push(`/atendimento/${item.dealId}`));
      return;
    }
    open(item.dealId, { query });
  };
  // 20/10: com "Minhas" ligado (fica salvo da última vez) a lista vinha vazia sem dizer por quê; e a busca não achava quem não tinha conversa aberta.
  const qp = new URLSearchParams(query);
  const term = qp.get("q")?.trim() ?? "";
  const onlyMine = qp.get("view") === "meus";
  const withoutMine = (() => { const p = new URLSearchParams(query); p.delete("view"); const s = p.toString(); return `/atendimento?${s || "view=todos"}`; })();
  // Esperando vazia (pesquisa 20/10): estado vazio positivo, sem cobrança.
  const waitingTab = qp.get("foco") === "aguardando" && !term;
  const empty = waitingTab && !onlyMine ? (
    <Empty title="Ninguém esperando resposta">Toda cliente que escreveu já teve resposta. Quando alguém escrever, aparece aqui, a que espera há mais tempo em cima.</Empty>
  ) : onlyMine ? (
    <Empty title="Nenhuma conversa sua aqui">
      Você está vendo só as suas conversas (filtro “Minhas”). <Link href={withoutMine} replace className="font-medium text-ink underline underline-offset-2">Mostrar as de todas</Link>
    </Empty>
  ) : undefined;
  const footer = term.length >= 3 ? <PeopleFound q={term} inList={new Set(sections.flatMap((s) => s.items.map((i) => i.contactId)))} /> : null;
  return (
    <>
      <QueueList empty={empty} footer={footer} sections={sections} selectedId={current} onOpen={onOpen} onStageTap={bulk ? onStageTap : undefined}
        onKindMenu={bulk ? (item, at) => setKindFor({ item, at }) : undefined} listRef={ref} onScroll={onScroll} className={className} selection={selection ?? undefined} />
      {selection && <SelectionAnnouncer count={chosen.length} />}
      {bulk && <BulkBar ids={chosen} options={bulk} openId={current} />}
      {bulk && <StageQuickMenu target={stageFor} stages={bulk.stages} onClose={() => setStageFor(null)} onDone={() => { setStageFor(null); router.refresh(); }}
        openHref={stageFor ? `/atendimento/${stageFor.dealId}` : "/atendimento"} />}
      <ContactKindPopover at={kindFor?.at ?? null} name={kindName} current={kindFor?.item.contactKind ?? "cliente"} onClose={closeKind}
        onPick={(k) => { if (kindFor) mark(kindFor.item.contactId, kindName, k); }} />
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

/**
 * "Voltar para a fila": devolve a pessoa à lista com os mesmos filtros (a rolagem volta pelo useQueueState).
 * No Quadro (a conversa aberta na gaveta de /funil), volta ao Quadro com os filtros dele.
 */
export function BackToQueue({ compact, className }: { compact?: boolean; className?: string }) {
  const saved = useSavedQueueQuery();
  const board = usePathname() === "/funil";
  const sp = useSearchParams();
  const label = board ? "Voltar para o quadro" : "Voltar para a fila";
  return (
    <Link href={board ? boardHref(sp.toString(), null) : saved ? `/atendimento?${saved}` : "/atendimento"} aria-label={label} title={label}
      className={cn(compact ? "inline-grid shrink-0 place-items-center size-11 rounded-[var(--radius-control)] text-ink hover:bg-paper-2" : "inline-flex items-center gap-2 min-h-11 px-3 -ml-1 rounded-[var(--radius-control)] text-sm font-medium text-ink hover:bg-paper-2", className)}>
      <IconArrowRight size={compact ? 20 : 15} className="rotate-180" aria-hidden />{compact ? null : label}
    </Link>
  );
}
