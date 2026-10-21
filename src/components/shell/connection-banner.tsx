"use client";
import Link from "next/link";
import { can } from "@/lib/permissions";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import { resumeAlertsAction } from "@/app/(app)/quiet/actions";
import { ResumeAlertsDialog } from "@/components/shell/resume-alerts-dialog";
import { quietUntilLabel } from "@/lib/late";
import { EASE, T } from "@/lib/motion";
import type { ShellBanners } from "@/server/queries/banners";

const enter = { initial: { opacity: 0, y: -8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -8 }, transition: { duration: T.base, ease: EASE } } as const;

/** Faixas no topo do app: WhatsApp caído (o lead não chega) e modo quieto (avisos pausados de propósito). Canal removido não entra. */
export function ShellBannersView({ banners, perms }: { banners: ShellBanners; perms: readonly string[] }) {
  const gestor = can(perms, "config.sistema");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [resumed, setResumed] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const down = banners.disconnected;
  const quiet = banners.quiet.filter((q) => !resumed.has(q.id));
  const resume = (id: string) => start(async () => {
    setError(null);
    const r = await resumeAlertsAction(id);
    setConfirmId(null);
    if (r.ok) setResumed((s) => new Set(s).add(id)); else setError(r.error);
  });

  return (
    <div className="flex flex-col">
      <AnimatePresence initial={false}>
        {down.length > 0 && (
          <motion.div key="conexao" {...enter} role="alert" data-testid="banner-conexao"
            className="bg-alert-soft text-alert border-b border-alert/30 px-5 lg:px-8 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-semibold">
              {down.length === 1 ? `O WhatsApp ${down[0].name} está desconectado.` : `${down.length} números de WhatsApp estão desconectados: ${down.map((d) => d.name).join(", ")}.`}
            </span>
            <span>Enquanto isso, conversas novas e mensagens não chegam.</span>
            {gestor
              ? <Link href="/config/whatsapp" className="inline-flex items-center min-h-11 lg:min-h-0 font-semibold underline underline-offset-2">Reconectar</Link>
              : <span>Avise a gestão.</span>}
          </motion.div>
        )}
        {quiet.map((q) => (
          <motion.div key={q.id} {...enter} role="status" data-testid="banner-quieto"
            className="bg-gold-soft text-gold-ink border-b border-gold/30 px-5 lg:px-8 py-2.5 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Número recém-conectado: avisos pausados {quietUntilLabel(new Date(q.until))}</span>
            {banners.quiet.length > 1 && <span className="text-xs">({q.name})</span>}
            {gestor && (
              <button type="button" disabled={pending} onClick={() => setConfirmId(q.id)}
                className="inline-flex items-center min-h-11 lg:min-h-0 px-1 font-semibold underline underline-offset-2 disabled:opacity-60">
                Retomar avisos agora
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
      <ResumeAlertsDialog open={confirmId !== null} onClose={() => setConfirmId(null)} pending={pending} onConfirm={() => confirmId && resume(confirmId)} />
      {error && <p role="alert" className="bg-alert-soft text-alert px-5 lg:px-8 py-2 text-sm">{error}</p>}
    </div>
  );
}
