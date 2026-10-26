"use client";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { IconBell, IconClose } from "@/components/icons";
import { claimAction, markAlertsReadAction, resolveAlertsAction } from "@/app/(app)/funil/actions";
import { Tabs } from "@/components/ui/tabs";
import { ALERT_GROUP_ORDER, ALERT_GROUP_TITLE, BELL_LEGEND, HELP_HREF, alertGroupOf } from "@/lib/alert-copy";
import type { AlertItem } from "@/server/queries/alerts";
import { isMuted, lateSoundOn, muteFor, setLateSound, subscribeAudio, unmute } from "./sound";
import { useLive } from "./live";
import { showClientNotice } from "./push-sync";
import { clientNotice } from "@/lib/client-notice";
import { SPRING_UI, EASE, T } from "@/lib/motion";
import { relTime } from "@/lib/format";
import { contactHref, leadHref } from "@/lib/lead-href";
import { isTop, popModal, pushModal } from "@/components/ui/modal-stack";

const FOCUSABLE = "a[href],button:not([disabled]),[tabindex]:not([tabindex='-1'])";
const noopSubscribe = () => () => {};

type Filtro = "tudo" | "mim" | "gestao";
/** Grupos do sino que nunca viram notificação do sistema nem som: sobem em degraus no próprio sino (selo → vermelho → gestão). */
const QUIET_GROUPS = new Set(["combinados", "lembretes"]);
const DOT = { alert: "bg-alert", gold: "bg-gold", ok: "bg-ok" } as const;

export function AlertsBell({ alerts, reload, gestao = false }: { alerts: AlertItem[]; reload?: () => Promise<void>;
  /** Recebe escaladas: mostra os filtros "Para mim" e "Para a gestão". */ gestao?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // O painel vive no <body>: dentro do header com backdrop-blur o `fixed` vira relativo ao header e o painel some/estoura.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [pending, start] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const unread = alerts.filter((a) => !a.read);
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const shown = alerts.filter((a) => filtro === "tudo" || (filtro === "mim" ? a.forMe : a.forGestao));
  const groups = ALERT_GROUP_ORDER.map((g) => ({ g, items: shown.filter((a) => alertGroupOf(a.type) === g) })).filter((x) => x.items.length > 0);
  const resolve = (a: AlertItem) => start(async () => { const r = await resolveAlertsAction([a.id]); if (r.ok) await reload?.(); });
  const [permTick, setPermTick] = useState(0);
  const [muted, setMuted] = useState(false);
  // "Som no atraso" deste aparelho (desligado por padrão); setLateSound avisa os assinantes do som.
  const lateSound = useSyncExternalStore(subscribeAudio, lateSoundOn, () => false);
  const notifPerm = useSyncExternalStore(
    (cb) => { window.addEventListener("focus", cb); return () => window.removeEventListener("focus", cb); },
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission) + "", () => "unsupported");
  void permTick;
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(alerts.map((a) => a.id)); return; }
    const fresh = alerts.filter((a) => !seen.current!.has(a.id) && !a.read);
    fresh.forEach((a) => seen.current!.add(a.id));
    if (!fresh.length) return;
    // Notificação do sistema (que toca som) só para o que pede ação agora: combinados e lembretes ficam no sino, em silêncio (fadiga de alerta, 20/10).
    // "A cliente escreveu" tem a notificação dela (abaixo, para toda a equipe): aqui não repete para a dona.
    const loud = fresh.find((a) => !QUIET_GROUPS.has(alertGroupOf(a.type)) && a.type !== "mensagem_cliente");
    if (loud && typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      new Notification("CRM Casa Fiaes", { body: loud.message, tag: loud.id });
    }
  }, [alerts]);

  // Toda mensagem de cliente vira notificação do sistema para quem está com o CRM aberto, não só para a dona (Cati 24/10).
  const live = useLive();
  useEffect(() => live.subscribe((ev) => {
    const n = clientNotice(ev);
    if (!n || typeof Notification === "undefined") return;
    void showClientNotice(n, {
      permission: Notification.permission, focused: document.visibilityState === "visible" && document.hasFocus(),
      hasPush: async () => !!(await (await navigator.serviceWorker?.getRegistration("/"))?.pushManager?.getSubscription()),
      show: (x) => {
        const note = new Notification(x.title, { body: x.body, tag: x.tag, icon: "/icon-192.png" });
        note.onclick = () => { window.focus(); router.push(x.url); note.close(); };
      },
    });
  }), [live, router]);

  // Tocar no alerta marca como lido e só então abre o lead (clique com Ctrl/Cmd ou botão do meio segue o link normal).
  const openAlert = (e: React.MouseEvent, a: AlertItem) => {
    setOpen(false);
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const href = a.href;
    if (a.read) { router.push(href); return; }
    start(async () => {
      try { await markAlertsReadAction([a.id]); void reload?.(); } catch { /* abrir o lead importa mais que marcar */ }
      router.push(href);
    });
  };

  const claimFromOffer = (a: AlertItem) => {
    if (!a.dealId) return;
    const href = leadHref(a.dealId);
    setOpen(false);
    start(async () => {
      const r = await claimAction(a.dealId!);
      try { await markAlertsReadAction([a.id]); void reload?.(); } catch { /* segue */ }
      if (r.ok) router.push(href); else void reload?.();
    });
  };

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setDesktop(window.matchMedia("(min-width: 1024px)").matches);
      setAnchor({ top: Math.round(r.bottom + 8), left: Math.max(8, Math.round(Math.min(r.left, window.innerWidth - 368))) });
    }
    setOpen((o) => !o);
  };

  // Esc fecha, Tab fica dentro do painel e o foco volta ao sino (mesma pilha de diálogos da Sheet).
  useEffect(() => {
    if (!open) return;
    const trigger = btnRef.current;
    const id = pushModal();
    const t = setTimeout(() => { if (isTop(id)) panelRef.current?.querySelector<HTMLElement>("a[href],button:not([data-close])")?.focus(); }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (!isTop(id)) return;
      if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); e.stopImmediatePropagation(); setOpen(false); }
      if (e.key === "Tab" && panelRef.current) {
        const f = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (!f.length) { e.preventDefault(); return; }
        const a = document.activeElement;
        if (!panelRef.current.contains(a)) { e.preventDefault(); f[0].focus(); }
        else if (e.shiftKey && a === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && a === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => { clearTimeout(t); document.removeEventListener("keydown", onKey); popModal(id); trigger?.focus?.(); };
  }, [open]);

  const panel = (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="fixed inset-0 z-[60] bg-ink/25 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }} onClick={() => setOpen(false)} aria-hidden data-testid="alerts-scrim" />
          <motion.div key="panel" ref={panelRef} role="dialog" aria-modal="true" aria-label="Alertas" data-testid="alerts-panel"
            style={{ "--bell-top": `${anchor.top}px`, "--bell-left": `${anchor.left}px` } as React.CSSProperties}
            initial={desktop ? { opacity: 0, y: -6, scale: 0.98 } : { y: "100%" }} animate={desktop ? { opacity: 1, y: 0, scale: 1 } : { y: 0 }} exit={desktop ? { opacity: 0, y: -4, scale: 0.98 } : { y: "100%" }}
            transition={desktop ? { duration: T.base, ease: EASE } : SPRING_UI}
            className="fixed z-[61] inset-x-0 bottom-0 lg:inset-x-auto lg:bottom-auto lg:top-[var(--bell-top)] lg:left-[var(--bell-left)] w-full lg:w-[360px] max-h-[80dvh] lg:max-h-[460px] flex flex-col bg-paper border border-line rounded-t-[var(--radius-panel)] lg:rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] pb-[env(safe-area-inset-bottom)] lg:pb-0">
            <div className="flex items-center justify-between gap-2 pl-4 pr-1 py-1.5 border-b border-line bg-paper rounded-t-[inherit] shrink-0">
              <p className="font-semibold text-sm">Alertas</p>
              <div className="flex items-center gap-1">
                <button className="min-h-11 lg:min-h-9 px-2 text-sm text-graphite hover:text-ink" onClick={() => { if (muted || isMuted()) { unmute(); setMuted(false); } else { muteFor(30); setMuted(true); } }}>
                  {muted ? "Som silenciado · ligar" : "Silenciar 30 min"}
                </button>
                {unread.length > 0 && <button className="min-h-11 lg:min-h-9 px-2 text-sm text-gold-ink hover:underline" onClick={() => start(async () => { await markAlertsReadAction(unread.map((a) => a.id)); await reload?.(); })}>Marcar como lidos</button>}
                <button data-close type="button" aria-label="Fechar alertas" onClick={() => setOpen(false)} className="lg:hidden size-11 grid place-items-center text-muted hover:text-ink"><IconClose size={16} /></button>
              </div>
            </div>
            <div className="overflow-y-auto scroll-thin min-h-0">
              {notifPerm === "default" && (
                <button className="w-full text-left px-4 py-3 min-h-11 text-sm bg-gold-soft text-gold-ink" onClick={async () => { await Notification.requestPermission(); setPermTick((t) => t + 1); }}>
                  Ativar notificações do navegador para não perder nenhuma conversa
                </button>
              )}
              {gestao && alerts.length > 0 && (
                <Tabs<Filtro> label="Para quem" value={filtro} onChange={setFiltro} className="mx-3 mt-2 [&_[role=tab]]:flex-auto [&_[role=tab]]:px-2 [&_[role=tab]]:whitespace-nowrap"
                  items={[{ value: "tudo", label: "Tudo", count: alerts.length }, { value: "mim", label: "Para mim", count: alerts.filter((a) => a.forMe).length },
                    { value: "gestao", label: "Para a gestão", count: alerts.filter((a) => a.forGestao).length }]} />
              )}
              {shown.length === 0 ? <p className="px-4 py-8 text-center text-muted text-sm">{alerts.length === 0 ? "Nenhum alerta nos últimos 7 dias." : "Nada neste filtro."}</p> : groups.map(({ g, items }) => (
                <section key={g} aria-labelledby={`sino-${g}`}>
                  <h3 id={`sino-${g}`} className="px-4 pt-3 pb-1 text-xs font-semibold text-muted">{ALERT_GROUP_TITLE[g]} <span className="tabular">({items.length})</span></h3>
                  <ul>
                    {items.map((a) => (
                      <li key={a.id} className="relative flex items-stretch border-b border-line/70">
                        <Link href={a.href} onClick={(e) => openAlert(e, a)} className="flex flex-1 min-w-0 gap-3 px-4 py-3 min-h-11 hover:bg-paper-2 transition-colors">
                          <span className={`mt-1.5 size-2 rounded-full shrink-0 ${a.read ? "opacity-50" : ""} ${a.resolved ? DOT.ok : a.severity === "urgente" ? DOT.alert : DOT.gold}`} />
                          <span className="min-w-0">
                            <span className={`block text-sm leading-snug ${a.read ? "text-graphite" : "font-medium"}`}>{!a.read && <span className="sr-only">não lido: </span>}{a.message}</span>
                            <span className="block text-xs text-muted mt-0.5">{relTime(a.createdAt)}{a.resolved ? " · resolvido" : ""}{gestao && a.forGestao && !a.forMe ? " · para a gestão" : ""}</span>
                          </span>
                        </Link>
                        {a.contactId && (
                          <Link href={contactHref(a.contactId)} onClick={() => setOpen(false)} aria-label={`Ficha de ${a.contactName?.trim() || "cliente"}`}
                            className="self-center mr-2 inline-flex h-9 items-center rounded-[var(--radius-control)] border border-line-strong px-3 text-sm font-medium text-ink shrink-0 hover:bg-paper-2 pointer-coarse:min-h-11">Ficha</Link>
                        )}
                        {/* Oferta da distribuição: assume com um toque e abre a conversa. */}
                        {a.type === "oferta" && !a.resolved && a.dealId && (
                          <button type="button" disabled={pending} onClick={() => claimFromOffer(a)}
                            className="self-center mr-2 h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] bg-ink text-paper text-sm font-medium shrink-0 disabled:opacity-60">Assumir</button>
                        )}
                        {a.resolvable && (
                          <button type="button" disabled={pending} onClick={() => resolve(a)} aria-label={`Resolver: ${a.message}`}
                            className="self-center mr-3 h-9 pointer-coarse:min-h-11 px-3 rounded-[var(--radius-control)] border border-line-strong text-sm font-medium text-ink shrink-0 hover:bg-paper-2 disabled:opacity-60">Resolver</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <footer className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-1.5 text-xs text-graphite">
              <button type="button" aria-pressed={lateSound} onClick={() => setLateSound(!lateSound)}
                title="Toca um bipe quando uma conversa passa do prazo. Mensagem de cliente sempre toca."
                className="inline-flex min-h-11 lg:min-h-8 items-center text-graphite hover:text-ink">{lateSound ? "Som no atraso: ligado" : "Som no atraso: desligado"}</button>
              {BELL_LEGEND.map((l) => <span key={l.tone} className="inline-flex items-center gap-1.5"><span aria-hidden className={`size-2 rounded-full ${DOT[l.tone]}`} />{l.text}</span>)}
              <Link href={HELP_HREF} onClick={() => setOpen(false)} className="ml-auto inline-flex min-h-11 lg:min-h-8 items-center text-gold-ink hover:underline">O que cada aviso quer dizer</Link>
            </footer>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      <button ref={btnRef} type="button" onClick={toggle} aria-label={`Alertas, ${unread.length} não lidos`} aria-expanded={open} aria-haspopup="dialog"
        className="relative size-11 lg:size-9 grid place-items-center rounded-[var(--radius-control)] text-graphite hover:bg-paper-3 hover:text-ink transition-colors">
        <IconBell />
        <AnimatePresence>
          {unread.length > 0 && (
            <motion.span key={unread.length} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={SPRING_UI}
              className="absolute top-0.5 right-0.5 lg:-top-0.5 lg:-right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-alert text-white text-xs font-semibold grid place-items-center tabular">
              {unread.length > 99 ? "99+" : unread.length}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      {mounted && createPortal(panel, document.body)}
    </div>
  );
}
