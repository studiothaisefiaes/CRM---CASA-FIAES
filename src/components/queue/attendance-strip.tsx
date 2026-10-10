"use client";
import { useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AttendanceDue } from "@/server/queries/queue";
import { setAttendanceAction } from "@/app/(app)/funil/actions";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconCheck, IconClose } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { formatPhoneClient } from "@/lib/phone-client";
import { DUR, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useOpenLead } from "./open-lead";
import { attendanceToast } from "./use-lead-actions";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bahia" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/**
 * "Conferir comparecimento": os agendados cujo horário já passou, com Compareceu e Faltou ali mesmo. Fica FORA do listbox da Fila
 * (botões dentro de uma `option` não são válidos): é uma lista comum com botões. Faltou cria a próxima ação "Remarcar".
 * Sai da lista assim que é marcado (o servidor não devolve mais quem já foi conferido).
 */
export function AttendanceStrip({ items }: { items: AttendanceDue[] }) {
  const toast = useToast();
  const openLead = useOpenLead();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const list = items.filter((i) => !gone.has(i.dealId));
  if (!list.length) return null;

  const mark = (i: AttendanceDue, status: "compareceu" | "faltou") => start(async () => {
    const r = await setAttendanceAction(i.dealId, status);
    if (!r.ok) { toast(r.error, "error"); return; }
    setGone((g) => new Set(g).add(i.dealId));
    const name = i.name === i.phone ? formatPhoneClient(i.phone) : i.name;
    toast(attendanceToast(name, status, r.data));
  });

  return (
    <section aria-label="Conferir comparecimento" className="shrink-0 border-b border-line bg-gold-soft/50 px-4 py-2.5">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-[0.08em] text-gold-ink">Conferir comparecimento <span className="tabular">({list.length})</span></h2>
      <ul className="flex max-h-44 flex-col overflow-y-auto overscroll-contain">
        <AnimatePresence initial={false}>
          {list.map((i) => {
            const name = i.name === i.phone ? formatPhoneClient(i.phone) : i.name;
            return (
              <motion.li key={i.dealId} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE }}
                data-testid="conferir-item" className="flex items-center gap-2.5 border-t border-line/70 py-1.5 first:border-t-0">
                <button type="button" onClick={() => openLead(i.dealId)} className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[var(--radius-control)] text-left lg:min-h-9">
                  <ContactAvatar contactId={i.contactId} hasAvatar={i.hasAvatar} name={name} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{name}</span>
                    <span className="block text-xs text-graphite tabular">{dia(i.scheduledAt)} às {hora(i.scheduledAt)}</span>
                  </span>
                </button>
                {([["compareceu", "Compareceu", IconCheck], ["faltou", "Faltou", IconClose]] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button" disabled={pending} onClick={() => mark(i, value)} aria-label={`${label}: ${name}`}
                    className={cn("inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] border px-2.5 text-sm font-medium transition-colors disabled:opacity-60 lg:min-h-9",
                      value === "compareceu" ? "border-ok/40 bg-paper text-ok hover:bg-ok-soft" : "border-alert/40 bg-paper text-alert hover:bg-alert-soft")}>
                    <Icon size={14} aria-hidden />{label}
                  </button>
                ))}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}
