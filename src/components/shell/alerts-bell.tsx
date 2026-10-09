"use client";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { IconBell } from "@/components/icons";
import { markAlertsReadAction } from "@/app/(app)/funil/actions";
import type { AlertItem } from "@/server/queries/alerts";
import { isMuted, muteFor, unmute } from "./sound";
import { SPRING, EASE } from "@/lib/motion";
import { relTime } from "@/lib/format";

export function AlertsBell({ alerts }: { alerts: AlertItem[] }) {
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const seen = useRef<Set<string> | null>(null);
  const unread = alerts.filter((a) => !a.read);
  const [permTick, setPermTick] = useState(0);
  const [muted, setMuted] = useState(false);
  const notifPerm = useSyncExternalStore(
    (cb) => { window.addEventListener("focus", cb); return () => window.removeEventListener("focus", cb); },
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission) + "", () => "unsupported");
  void permTick;
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(alerts.map((a) => a.id)); return; }
    const fresh = alerts.filter((a) => !seen.current!.has(a.id) && !a.read);
    fresh.forEach((a) => seen.current!.add(a.id));
    if (!fresh.length) return;
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.visibilityState !== "visible") {
      new Notification("CRM Casa Fiaes", { body: fresh[0].message, tag: fresh[0].id });
    }
  }, [alerts]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-label={`Alertas, ${unread.length} não lidos`} aria-expanded={open}
        className="relative size-9 grid place-items-center rounded-[var(--radius-control)] text-graphite hover:bg-paper-3 hover:text-ink transition-colors">
        <IconBell />
        <AnimatePresence>
          {unread.length > 0 && (
            <motion.span key={unread.length} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={SPRING}
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-alert text-white text-[10.5px] font-semibold grid place-items-center tabular">
              {unread.length > 99 ? "99+" : unread.length}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }} transition={{ duration: 0.18, ease: EASE }}
              className="fixed lg:absolute z-50 inset-x-0 bottom-0 lg:bottom-auto lg:inset-x-auto lg:left-0 lg:top-11 w-full lg:w-[360px] max-h-[75dvh] lg:max-h-[460px] overflow-auto scroll-thin bg-paper border border-line rounded-t-[var(--radius-panel)] lg:rounded-[var(--radius-card)] shadow-[var(--shadow-pop)] pb-[env(safe-area-inset-bottom)]" role="dialog" aria-label="Alertas">
              <div className="flex items-center justify-between px-4 py-3 border-b border-line sticky top-0 bg-paper">
                <p className="font-semibold text-sm">Alertas</p>
                <div className="flex items-center gap-3">
                  <button className="text-sm text-graphite hover:text-ink" onClick={() => { if (muted || isMuted()) { unmute(); setMuted(false); } else { muteFor(30); setMuted(true); } }}>
                    {muted ? "Som silenciado · ligar" : "Silenciar 30 min"}
                  </button>
                  {unread.length > 0 && <button className="text-sm text-gold-ink hover:underline" onClick={() => start(async () => { await markAlertsReadAction(unread.map((a) => a.id)); })}>Marcar como lidos</button>}
                </div>
              </div>
              {notifPerm === "default" && (
                <button className="w-full text-left px-4 py-2.5 text-sm bg-gold-soft text-gold-ink" onClick={async () => { await Notification.requestPermission(); setPermTick((t) => t + 1); }}>
                  Ativar notificações do navegador para não perder nenhum lead
                </button>
              )}
              {alerts.length === 0 ? <p className="px-4 py-8 text-center text-muted text-sm">Nenhum alerta nos últimos 7 dias.</p> : (
                <ul>
                  {alerts.map((a) => (
                    <li key={a.id}>
                      <Link href={a.dealId ? `/funil?lead=${a.dealId}` : "/funil"} onClick={() => setOpen(false)}
                        className={`flex gap-3 px-4 py-3 border-b border-line/70 hover:bg-paper-2 transition-colors ${a.read ? "opacity-60" : ""}`}>
                        <span className={`mt-1.5 size-2 rounded-full shrink-0 ${a.resolved ? "bg-ok" : a.severity === "urgente" ? "bg-alert" : "bg-gold"}`} />
                        <span className="min-w-0">
                          <span className="block text-sm leading-snug">{a.message}</span>
                          <span className="block text-xs text-muted mt-0.5">{relTime(a.createdAt)}{a.resolved ? " · resolvido" : ""}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
