"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { DealDetail } from "@/server/queries/deal";
import type { QueueItem } from "@/server/queries/queue";
import { Bubble, Conversation, quotePreview, WRAP, type Msg } from "@/components/lead/conversation";
import { Composer, type QuoteTarget } from "@/components/lead/composer";
import { LeadSide, useStageMove } from "@/components/lead/lead-sheet";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { IconArrowRight, IconCheck } from "@/components/icons";
import { useLive } from "@/components/shell/live";
import { markConversationReadAction } from "@/app/(app)/funil/actions";
import { getConversationAction, nextWaitingAction } from "@/app/(app)/atendimento/actions";
import { formatPhoneClient } from "@/lib/phone-client";
import { DUR, EASE } from "@/lib/motion";
import { PaneHeader, type PaneBack, type PaneTab } from "./pane-header";
import { knownItem, useCloseLead, useCurrentLead, useOpenLead, ViewportRedirect } from "./open-lead";
import { rememberLead } from "./use-queue-state";

const displayName = (d: DealDetail | null, item: QueueItem | null) =>
  d ? d.contact.name?.trim() || formatPhoneClient(d.contact.phoneE164) : item ? (item.name === item.phone ? formatPhoneClient(item.phone) : item.name) : "";

/** A última mensagem do item da Fila como balão, para a conversa não abrir vazia enquanto o histórico chega. */
const lastMessageOf = (item: QueueItem): Msg => ({
  id: "inicial", direction: item.lastDirection ?? "in", kind: item.lastKind ?? "text", body: item.lastMessage, status: item.lastDirection === "out" ? "sent" : "received",
  createdAt: item.lastAt ?? new Date(0).toISOString(), sender: null, fromPhone: false,
});

/** Esqueleto discreto do histórico: balões apagados e, no fim, a última mensagem de verdade. */
function ConversationSkeleton({ item, error, onRetry }: { item: QueueItem | null; error: string | null; onRetry: () => void }) {
  const bar = "rounded-[var(--radius-card)] bg-paper-2 motion-safe:animate-pulse";
  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      <div role="log" aria-label="Mensagens" aria-busy={!error} className={`flex-1 min-h-0 overflow-hidden px-4 py-4 flex flex-col justify-end gap-1.5 ${WRAP}`}>
        {error ? (
          <div role="alert" className="m-auto text-center text-sm text-graphite">
            <p>{error}</p>
            <button type="button" onClick={onRetry} className="mt-2 min-h-11 px-4 rounded-[var(--radius-control)] border border-line-strong font-medium text-ink hover:bg-paper-2">Tentar de novo</button>
          </div>
        ) : (
          <>
            <span aria-hidden className={`self-start h-11 w-[46%] ${bar}`} />
            <span aria-hidden className={`self-end h-9 w-[38%] ${bar}`} />
            <span aria-hidden className={`self-start h-14 w-[58%] ${bar}`} />
            {item && (item.lastMessage || item.lastKind) && <Bubble m={lastMessageOf(item)} day={null} animateIn={false} />}
            <span className="sr-only" role="status">Carregando a conversa</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Histórico apagado e um campo de mensagem sem ação: o lugar de tudo já está reservado quando a tela de verdade chega. */
export function ConversationSkeletonShell({ item }: { item: QueueItem | null }) {
  return (
    <section aria-label="Conversa" className="min-h-0 min-w-0 flex-1 flex flex-col">
      <ConversationSkeleton item={item} error={null} onRetry={() => {}} />
      <div aria-hidden className="shrink-0 border-t border-line bg-paper px-3 pt-3 pb-[max(0.375rem,env(safe-area-inset-bottom))] lg:pb-3"><div className="h-11 rounded-[var(--radius-control)] bg-paper-2" /></div>
    </section>
  );
}

function SideSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {[0, 1, 2, 3].map((i) => <div key={i} className="flex flex-col gap-1.5"><span className="h-3 w-16 rounded bg-paper-3/70" /><span className="h-9 rounded-[var(--radius-control)] bg-paper-2 motion-safe:animate-pulse" /></div>)}
    </div>
  );
}

/**
 * A conversa no painel do meio da Fila (e a tela cheia do celular). Abre na hora: o cabeçalho e a última mensagem vêm do `initial`
 * (o item da Fila) e o histórico e os dados chegam por Server Action. Depois de responder, oferece "Próximo da fila".
 * Fique com `key={dealId}`: trocar de lead monta uma conversa nova (estado limpo, "lido" marcado uma vez).
 */
export function ConversationPane({ dealId, initial, initialTab = "conversa", back = "below-lg" }: {
  dealId: string; initial: QueueItem | null; initialTab?: PaneTab; back?: PaneBack;
}) {
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<PaneTab>(initialTab);
  const [answered, setAnswered] = useState(false);
  const [next, setNext] = useState<{ id: string | null; name: string | null } | null>(null);
  const [optimistic, setOptimistic] = useState<{ text: string; at: number } | null>(null);
  const [replyTo, setReplyTo] = useState<QuoteTarget | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const toast = useToast();
  const openLead = useOpenLead();
  const closeLead = useCloseLead();
  const seq = useRef(0);
  const stale = useRef(false);

  /** Busca a conversa. Devolve se deu certo (a rede ou o servidor podem falhar; quem chama decide o que fazer). */
  const load = useCallback((): Promise<boolean> => {
    const mine = ++seq.current;
    return getConversationAction(dealId).then((r) => {
      if (mine !== seq.current) return true; // chegou uma resposta mais nova
      if (r.ok) { setDetail(r.data); setError(null); return true; }
      setError((e) => e ?? r.error);
      return false;
    }, () => { if (mine === seq.current) setError((e) => e ?? "Não foi possível abrir a conversa. Tente de novo."); return false; });
  }, [dealId]);

  // O histórico primeiro (as Server Actions andam em fila); o "lido" logo depois, uma vez por abertura (o StrictMode do dev roda o efeito duas vezes).
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    void load();
    if (readFor.current === dealId) return;
    readFor.current = dealId;
    void markConversationReadAction(dealId);
  }, [load, dealId]);
  useEffect(() => { rememberLead(dealId); }, [dealId]);

  // Tempo real: só avisos deste lead; rajada vira uma busca só, e com a aba oculta espera ela voltar.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive([`deal:${dealId}`], () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { if (document.visibilityState === "visible") void load(); else stale.current = true; }, 250);
  });
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible" && stale.current) { stale.current = false; void load(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  const name = displayName(detail, initial);
  const firstName = (detail?.contact.name ?? (initial && initial.name !== initial.phone ? initial.name : "")).trim().split(/\s+/)[0] ?? "";
  const msgs: Msg[] = useMemo(() => {
    if (!detail) return [];
    const base = detail.messages.map((m) => ({ id: m.id, externalId: m.externalId, direction: m.direction, kind: m.kind, body: m.body, status: m.status, createdAt: new Date(m.createdAt).toISOString(), sender: m.sender, fromPhone: m.fromPhone, error: m.error, hasMedia: m.hasMedia, quotedBody: m.quotedBody, edited: !!m.editedAt, deleted: !!m.deletedAt }));
    // A mensagem que acabou de ser enviada já chegou do servidor: não mostra o balão provisório junto.
    const arrived = !!optimistic && base.some((m) => m.direction === "out" && m.body === optimistic.text && new Date(m.createdAt).getTime() >= optimistic.at - 2000);
    return optimistic && !arrived ? [...base, { id: "optimistic", direction: "out" as const, kind: "text", body: optimistic.text, status: "pending", createdAt: new Date(optimistic.at).toISOString(), sender: null, fromPhone: false }] : base;
  }, [detail, optimistic]);

  // Segura o balão provisório até o histórico novo chegar, para a mensagem enviada não piscar.
  // Se a busca falhar, o balão fica (a mensagem foi enviada; sumir daria a impressão de que não foi) e a atendente é avisada.
  const onOptimistic = useCallback((text: string | null) => {
    if (text !== null) { setOptimistic({ text, at: Date.now() }); return; }
    void load().then((ok) => { if (ok) setOptimistic(null); else toast("Não deu para atualizar a conversa", "error"); });
  }, [load, toast]);
  const onSent = useCallback(() => {
    setAnswered(true);
    setSentCount((n) => n + 1);
    void nextWaitingAction(dealId).then((r) => { if (r.ok) setNext({ id: r.id, name: r.name }); });
  }, [dealId]);
  const onReply = useCallback((m: Msg) => setReplyTo({ id: m.id, text: quotePreview(m) }), []);

  const { moveTo, dialogs } = useStageMove(detail, name);
  const slaMinutes = detail ? detail.stage.slaMinutes : initial?.slaMinutes ?? null;

  return (
    <>
      <div role="region" aria-label={name ? `Lead ${name}` : "Lead"} className="min-h-0 h-full flex flex-col xl:col-span-2 xl:grid xl:grid-cols-subgrid xl:grid-rows-[auto_minmax(0,1fr)]">
        <header className="shrink-0 border-b border-line xl:col-start-1 xl:row-start-1 min-w-0">
          <PaneHeader item={initial} d={detail} name={name} answered={answered} back={back} tab={tab} onTab={setTab} onMove={moveTo} onClose={closeLead} />
        </header>
        <section aria-label="Conversa" className={`min-h-0 min-w-0 flex-col flex-1 ${tab === "conversa" ? "flex" : "hidden"} xl:flex xl:col-start-1 xl:row-start-2`}>
          {detail ? <Conversation messages={msgs} onReply={onReply} forceEndKey={sentCount} visible={tab === "conversa"} /> : <ConversationSkeleton item={initial} error={error} onRetry={() => { setError(null); void load(); }} />}
          <AnimatePresence initial={false}>
            {answered && next && (
              <motion.div key="proximo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE }} className="shrink-0 px-3 pt-2">
                {next.id ? (
                  <button type="button" onClick={() => openLead(next.id!)}
                    className="w-full min-h-11 px-3 rounded-[var(--radius-control)] bg-gold-soft text-gold-ink text-sm font-semibold inline-flex items-center justify-center gap-2 hover:brightness-[0.98]">
                    <span>Próximo da fila</span>{next.name && <span className="font-normal truncate">{next.name}</span>}<IconArrowRight size={15} aria-hidden />
                  </button>
                ) : (
                  <p role="status" className="min-h-11 inline-flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-ok-soft text-ok text-sm font-semibold"><IconCheck size={15} aria-hidden />Fila em dia ✓</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <Composer dealId={dealId} firstName={firstName} quickReplies={detail?.quickReplies ?? []} onOptimistic={onOptimistic} onSent={onSent}
            replyTo={replyTo} onClearReply={() => setReplyTo(null)} slaSeconds={slaMinutes ? slaMinutes * 60 : null} />
        </section>
        <section aria-label="Dados do cliente" className={`min-h-0 overflow-y-auto scroll-thin px-5 py-4 flex-1 ${tab === "conversa" ? "hidden" : "block"} xl:block xl:flex-none xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:border-l border-line bg-paper-2/40`}>
          {detail ? <LeadSide d={detail} tab={tab} bp="xl" cols="grid-cols-1" /> : <SideSkeleton />}
        </section>
      </div>
      {dialogs}
    </>
  );
}

/**
 * Os painéis do meio e da direita de /atendimento: acompanha o `?lead=` (que a lista troca sem recarregar a página)
 * e abre a conversa com o item da Fila que já está no navegador. `serverLead`/`serverItem` valem na primeira carga.
 */
export function ConversationPaneRoute({ serverLead, serverItem }: { serverLead: string | null; serverItem: QueueItem | null }) {
  const lead = useCurrentLead(serverLead);
  if (!lead) {
    return (
      <>
        <section aria-label="Conversa" className="hidden lg:grid place-items-center bg-paper-2/50"><Empty title="Escolha uma conversa">Use as setas para percorrer a fila e Enter para abrir. A conversa e os dados da cliente aparecem aqui.</Empty></section>
        <aside aria-label="Dados do cliente" className="hidden xl:grid place-items-center border-l border-line bg-paper-2/30 px-6 text-center text-sm text-muted">Os dados da cliente aparecem aqui.</aside>
      </>
    );
  }
  const item = knownItem(lead) ?? (serverItem?.dealId === lead ? serverItem : null);
  return (
    <div className="hidden lg:contents">
      <ViewportRedirect when="mobile" to={`/atendimento/${lead}`} />
      <ConversationPane key={lead} dealId={lead} initial={item} back={false} />
    </div>
  );
}
