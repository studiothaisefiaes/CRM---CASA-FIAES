"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AnimatePresence, motion } from "motion/react";
import type { DealDetail } from "@/server/queries/deal";
import type { QueueItem } from "@/server/queries/queue";
import { Bubble, Conversation, optimisticArrived, quotePreview, WRAP, type Msg } from "@/components/lead/conversation";
import { mergeTimeline, messagesToMsgs } from "@/components/lead/timeline";
import { useCallActions } from "@/components/lead/use-call-actions";
import { RetomadaStrip } from "./retomada-strip";
import { Sheet } from "@/components/ui/sheet";
import { useDesktop } from "./use-desktop";
import { Composer, type QuoteTarget } from "@/components/lead/composer";
import { AiSuggestion } from "@/components/lead/ai-suggestion";
import { useDeleteForEveryone } from "@/components/lead/delete-message";
import { useMessageTools } from "@/components/lead/message-tools-ui";
import { Empty } from "@/components/ui/empty";
import { useToast } from "@/components/ui/toast";
import { IconArrowRight, IconCheck } from "@/components/icons";
import { useLive } from "@/components/shell/live";
import { canMarkReadNow } from "./read-gate";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import { fetchNextWaiting, isFresh, loadConversation, markConversationRead, peekConversation } from "./conversation-cache";
import { useConversationCacheLive } from "./use-conversation-cache-live";
import { T, EASE } from "@/lib/motion";
import { PaneHeader, type PaneBack, type WaWarning } from "./pane-header";
import { ClientPane, type SideTab } from "./client-pane";
import { useLeadActions } from "./use-lead-actions";
import { knownItem, useCloseLead, useCurrentLead, useOpenLead, ViewportRedirect } from "./open-lead";
import { rememberLead } from "./use-queue-state";
import { lastMessageOf, paneName } from "./last-message";
import { can } from "@/lib/permissions";
import { displayName } from "@/lib/display-name";

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
 * (o item da Fila) e o histórico e os dados chegam por GET /api/conversa/[id] (fora da fila das Server Actions); a conversa já buscada
 * (pré-busca do hover, aberta antes) aparece na hora e se atualiza por trás. Depois de responder, oferece "Próximo da fila".
 * Fique com `key={dealId}`: trocar de lead monta uma conversa nova (estado limpo, "lido" marcado uma vez).
 */
export function ConversationPane({ dealId, initial, initialTab = "conversa", back = "below-lg", wa, focusComposer, openSchedule, prefillReply = null }: {
  dealId: string; initial: QueueItem | null;
  /** "dados": abre com o painel da cliente aberto (celular, rota /atendimento/[id]/cliente). */
  initialTab?: "conversa" | "dados"; back?: PaneBack; wa?: WaWarning;
  /** Abre com o cursor no campo de mensagem (vindo de "Iniciar conversa"). */
  focusComposer?: boolean;
  /** "Mandar parabéns" (Hoje): o campo abre com a resposta "aniversario" preenchida; só a atendente envia. */
  prefillReply?: "aniversario" | null;
  /** Abre a folha Agendar assim que os dados chegam (vindo do "Agendar" da ficha da cliente). */
  openSchedule?: boolean;
}) {
  // Já buscada (aberta antes ou pré-buscada): aparece na hora; a busca de agora só atualiza.
  const [detail, setDetail] = useState<DealDetail | null>(() => peekConversation(dealId)?.data ?? null);
  const [viewer, setViewer] = useState<Viewer | null>(() => peekConversation(dealId)?.viewer ?? null);
  const [error, setError] = useState<string | null>(null);
  const [side, setSide] = useState<SideTab>("agora");
  /** Abaixo de 1280 px o painel da cliente abre por "ⓘ Cliente" (tela cheia no celular). */
  const [info, setInfo] = useState(initialTab === "dados");
  const desktop = useDesktop();
  const [answered, setAnswered] = useState(false);
  /** "Enviada. E agora?" depois de mandar mensagem: some ao escolher, ao fechar ou quando a cliente escreve de novo. */
  const [afterSend, setAfterSend] = useState(false);
  const [next, setNext] = useState<{ id: string | null; name: string | null } | null>(null);
  const [optimistic, setOptimistic] = useState<{ text: string; at: number } | null>(null);
  const [replyTo, setReplyTo] = useState<QuoteTarget | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const toast = useToast();
  const openLead = useOpenLead();
  const closeLead = useCloseLead();
  const seq = useRef(0);
  const stale = useRef(false);

  // Trocar de conversa cancela a busca desta (se ninguém mais espera por ela, ex.: a pré-busca).
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { const c = new AbortController(); abort.current = c; return () => c.abort(); }, []);

  /**
   * Busca a conversa. Devolve se deu certo (a rede ou o servidor podem falhar; quem chama decide o que fazer).
   * `fresh` (padrão): depois de uma mudança, sempre um pedido novo. Na abertura, junta com a pré-busca a caminho.
   */
  const fetchDetail = useCallback((fresh: boolean): Promise<boolean> => {
    const mine = ++seq.current;
    return loadConversation(dealId, { fresh, signal: abort.current?.signal }).then((r) => {
      if (mine !== seq.current) return true; // chegou uma resposta mais nova
      if (r.ok) { setDetail(r.data); setViewer(r.viewer); setError(null); return true; }
      setError((e) => e ?? r.error);
      return false;
    }, () => { if (mine === seq.current && !abort.current?.signal.aborted) setError((e) => e ?? "Não foi possível abrir a conversa. Tente de novo."); return false; });
  }, [dealId]);
  const load = useCallback(() => fetchDetail(true), [fetchDetail]);
  useConversationCacheLive();

  // O histórico primeiro; o "lido" logo depois (POST leve, fora da fila das Server Actions), uma vez por abertura (o StrictMode do dev roda o efeito duas vezes).
  // Guardada há pouco e sem aviso depois: não busca de novo.
  const readFor = useRef<string | null>(null);
  useEffect(() => {
    const opened = isFresh(dealId) ? Promise.resolve(true) : fetchDetail(false);
    if (readFor.current === dealId) return;
    readFor.current = dealId;
    void opened.finally(() => markConversationRead(dealId));
  }, [fetchDetail, dealId]);
  useEffect(() => { rememberLead(dealId); }, [dealId]);

  // Tempo real: só avisos deste lead; rajada vira uma busca só, e com a aba oculta espera ela voltar.
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Mensagem da cliente chegando com a conversa aberta também é lida, mas só com alguém olhando: aba visível E janela em foco (`canMarkReadNow`).
  // Sem isso fica pendente (`unseen`) até a aba voltar ou a janela ganhar foco. O servidor só marca se chegou algo depois do último visto.
  const unseen = useRef(false);
  const markIfLooking = useCallback(() => {
    if (!unseen.current || !canMarkReadNow(document)) return;
    unseen.current = false;
    markConversationRead(dealId);
  }, [dealId]);
  useLive([`deal:${dealId}`], (e) => {
    clearTimeout(timer.current);
    if (e.type === "mensagem_recebida") unseen.current = true;
    timer.current = setTimeout(() => {
      if (document.visibilityState !== "visible") { stale.current = true; return; }
      void load();
      markIfLooking();
    }, 250);
  });
  useEffect(() => {
    const onBack = () => {
      if (document.visibilityState !== "visible") return;
      if (stale.current) { stale.current = false; void load(); }
      markIfLooking();
    };
    document.addEventListener("visibilitychange", onBack);
    window.addEventListener("focus", onBack);
    return () => { clearTimeout(timer.current); document.removeEventListener("visibilitychange", onBack); window.removeEventListener("focus", onBack); };
  }, [load, markIfLooking]);

  const name = paneName(detail, initial);
  const firstName = (detail?.contact.name ?? (initial && initial.name !== initial.phone ? initial.name : "")).trim().split(/\s+/)[0] ?? "";
  const msgs: Msg[] = useMemo(() => {
    if (!detail) return [];
    const base = mergeTimeline(messagesToMsgs(detail.messages), detail.notes);
    // A mensagem que acabou de ser enviada já chegou do servidor: não mostra o balão provisório junto.
    const arrived = !!optimistic && optimisticArrived(base, optimistic);
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
    setAfterSend(true);
    setSentCount((n) => n + 1);
    void fetchNextWaiting(dealId).then((r) => { if (r.ok) setNext({ id: r.id, name: r.name }); });
  }, [dealId]);
  const onReply = useCallback((m: Msg) => setReplyTo({ id: m.id, text: quotePreview(m) }), []);
  // 17/10: "Apagar para todos" pelo menu da mensagem enviada; depois recarrega a conversa.
  const del = useDeleteForEveryone(() => { void load(); });
  const mtools = useMessageTools(detail?.tools, viewer?.id, () => { void load(); }, dealId);

  const actions = useLeadActions({ d: detail, name, viewer, reload: load });
  // "Agendar" da ficha (?agendar=1): abre a folha uma vez, quando o lead carregou.
  const scheduleOpened = useRef(false);
  useEffect(() => {
    if (!openSchedule || scheduleOpened.current || !detail) return;
    scheduleOpened.current = true;
    actions.open("schedule");
  }, [openSchedule, detail, actions]);
  const openScheduleSheet = useCallback(() => actions.open("schedule"), [actions]);
  const callActions = useCallActions(detail?.deal.id, load, openScheduleSheet);
  const lastDir = detail?.messages.at(-1)?.direction;
  const showAfterSend = afterSend && !!detail && detail.stage.kind !== "fechado" && detail.stage.kind !== "perdido" && lastDir !== "in";
  const slaMinutes = detail ? detail.stage.slaMinutes : initial?.slaMinutes ?? null;

  return (
    <>
      {del.dialog}
      {mtools.dialog}
      <div role="region" aria-label={name ? `Conversa com ${name}` : "Conversa"} className="min-h-0 h-full flex flex-col xl:col-span-2 xl:grid xl:grid-cols-subgrid xl:grid-rows-[auto_minmax(0,1fr)]">
        <header className="shrink-0 border-b border-line xl:col-start-1 xl:row-start-1 min-w-0">
          <PaneHeader item={initial} d={detail} name={name} answered={answered} back={back} actions={actions} viewer={viewer} wa={wa} onClose={closeLead} onInfo={() => setInfo(true)} />
        </header>
        <section aria-label="Conversa" className="min-h-0 min-w-0 flex-col flex-1 flex xl:col-start-1 xl:row-start-2">
          {/* Espiar sem assumir (pesquisa 20/10): a gestão lê sem tirar o "não lida" da dona (isPeek no servidor). */}
          {detail && viewer && can(viewer.perms, "alertas.escalada") && detail.deal.ownerId && detail.deal.ownerId !== viewer.id && (
            <p className="shrink-0 border-b border-line bg-paper-2/60 px-4 py-1.5 text-xs text-graphite" data-testid="espiando">
              Espiando: para {displayName((detail.ownerName ?? "a dona").trim().split(/\s+/)[0])} a conversa continua não lida. Responder marca como lida.
            </p>
          )}
          {detail ? <Conversation messages={msgs} onReply={onReply} onDelete={del.onDelete} onHide={del.onHide} tools={mtools.tools} forceEndKey={sentCount} visible={!info || desktop} callActions={callActions} /> : <ConversationSkeleton item={initial} error={error} onRetry={() => { setError(null); void load(); }} />}
          <AnimatePresence initial={false}>
            {showAfterSend && detail && (
              <motion.div key="e-agora" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
                role="group" aria-label="Próximo passo depois de enviar" className="shrink-0 px-3 pt-2">
                <div className="flex flex-wrap items-center gap-1.5 rounded-[var(--radius-control)] border border-line bg-paper-2/70 px-2.5 py-2">
                  <span className="mr-1 inline-flex items-center gap-1.5 text-sm text-graphite"><IconCheck size={14} className="text-ok" aria-hidden />Enviada. E agora?</span>
                  {[
                    { label: "Retomar…", run: () => actions.openResume() },
                    { label: detail.stage.kind === "agendado" ? "Remarcar" : "Agendar", run: () => actions.open("schedule") },
                    { label: "Resolver", run: actions.archiveConversation },
                  ].map((b) => (
                    <button key={b.label} type="button" disabled={actions.busy} onClick={() => { setAfterSend(false); b.run(); }}
                      className="min-h-9 rounded-full border border-line-strong bg-paper px-3 text-sm font-medium text-ink transition-colors hover:border-ink disabled:opacity-60 pointer-coarse:min-h-11">{b.label}</button>
                  ))}
                  <button type="button" onClick={() => setAfterSend(false)} aria-label="Agora não"
                    className="ml-auto min-h-9 px-2 text-sm text-muted hover:text-ink pointer-coarse:min-h-11">Agora não</button>
                </div>
              </motion.div>
            )}
            {answered && next && (
              <motion.div key="proximo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }} className="shrink-0 px-3 pt-2">
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
          <AiSuggestion dealId={dealId} replyTo={replyTo} onBook={actions.canBookFromAi ? actions.bookFromAi : undefined} />
          <RetomadaStrip items={detail?.scheduled ?? []} actions={actions} onChange={() => { void load(); }} />
          <Composer dealId={dealId} firstName={firstName} quickReplies={detail?.quickReplies ?? []} onOptimistic={onOptimistic} onSent={onSent}
            replyTo={replyTo} onClearReply={() => setReplyTo(null)} slaSeconds={slaMinutes ? slaMinutes * 60 : null} autoFocus={focusComposer} prefillReply={prefillReply}
            team={detail?.people ?? []} onNoteSaved={() => { void load(); }} onScheduled={() => { void load(); }} vars={detail?.replyVars}
            canShareReplies={detail?.canShareReplies} libraryEnabled={detail?.canLibrary} tools={detail?.tools} onRepliesChanged={() => { void load(); }} signature={viewer?.signature ?? null}
            onProgram={(text) => actions.openResume({ text })} me={viewer?.id ?? null} />
        </section>
        <section aria-label="Dados do cliente" className="hidden min-h-0 overflow-y-auto scroll-thin px-4 py-3 xl:block xl:col-start-2 xl:row-start-1 xl:row-span-2 xl:border-l border-line bg-paper-2/40">
          {detail ? <ClientPane d={detail} viewer={viewer} actions={actions} tab={side} onTab={setSide} /> : <SideSkeleton />}
        </section>
      </div>
      {detail && (
        <Sheet open={info} onClose={() => setInfo(false)} title={name || "Cliente"} side={desktop ? "right" : "bottom"} className="xl:hidden">
          <ClientPane d={detail} viewer={viewer} actions={actions} tab={side} onTab={setSide} />
        </Sheet>
      )}
      {actions.sheets}
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
