"use client";
import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { AttendanceDue } from "@/server/queries/queue";
import { setAttendanceAction, undoMissedAttendanceAction } from "@/app/(app)/funil/actions";
import { useConfirmNoShow } from "@/components/ui/confirm-no-show";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconCheck, IconClose } from "@/components/icons";
import { useToast } from "@/components/ui/toast";
import { formatPhoneClient } from "@/lib/phone-client";
import { T, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { useOpenLead } from "./open-lead";
import { attendanceToast } from "./use-lead-actions";
import { ATTENDANCE_HELP, ATTENDANCE_TITLE } from "@/lib/alert-copy";

const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Bahia" });
const dia = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Bahia" });

/**
 * "Ela veio?": os agendados cujo horário já passou, com Compareceu e Faltou ali mesmo. Começa aberta, porque é pendência; no celular
 * cada item é uma coluna (nome e hora em cima, botões embaixo: P9, 17/10, o nome era cortado em "Flávia G…") e a lista mostra 1 item por vez e rola (a frase de ajuda fica só para leitor de tela), para a primeira conversa da Fila aparecer sem rolar. Fica FORA do listbox da Fila
 * (botões dentro de uma `option` não são válidos): é uma lista comum com botões. Faltou cria a próxima ação "Remarcar".
 * Sai da lista assim que é marcado (o servidor não devolve mais quem já foi conferido).
 * "Atrasada" (Cati 29/10: confirmou e ainda não chegou; não é Veio nem Faltou): some daqui por 30 min e volta a perguntar. Não muda nada no servidor.
 */
const ATRASO_MS = 30 * 60_000;
export function AttendanceStrip({ items }: { items: AttendanceDue[] }) {
  const toast = useToast();
  const openLead = useOpenLead();
  const [pending, start] = useTransition();
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(true); // começa aberta: é pendência
  const [late, setLate] = useState<Record<string, number>>({});
  const [nowMs, setNowMs] = useState(() => Date.now());
  // A próxima "Atrasada" que vence: o item volta sozinho.
  useEffect(() => {
    const next = Math.min(...Object.values(late).filter((t) => t > nowMs));
    if (!Number.isFinite(next)) return;
    const t = setTimeout(() => setNowMs(Date.now()), next - nowMs + 500);
    return () => clearTimeout(t);
  }, [late, nowMs]);
  const confirmNoShow = useConfirmNoShow();
  const list = items.filter((i) => !gone.has(i.dealId) && !((late[i.dealId] ?? 0) > nowMs));
  if (!list.length) return null;
  const toggle = () => setOpen((o) => !o);

  const doMark = (i: AttendanceDue, status: "compareceu" | "faltou") => start(async () => {
    const r = await setAttendanceAction(i.dealId, status);
    if (!r.ok) { toast(r.error, "error"); return; }
    setGone((g) => new Set(g).add(i.dealId));
    const name = i.name === i.phone ? formatPhoneClient(i.phone) : i.name;
    // Faltou tem Desfazer (QA r58, M-2): a conversa volta como estava e o item volta para a lista.
    const undo = status === "faltou" && r.data?.changed ? { label: "Desfazer", onClick: () => start(async () => {
      const u = await undoMissedAttendanceAction(i.dealId);
      if (!u.ok) { toast(u.error, "error"); return; }
      setGone((g) => { const n = new Set(g); n.delete(i.dealId); return n; });
      toast(`Desfeito: ${name} voltou para a lista`);
    }) } : undefined;
    toast(attendanceToast(name, status, r.data), "ok", undo);
  });
  const mark = (i: AttendanceDue, status: "compareceu" | "faltou") => (status === "faltou"
    ? confirmNoShow({ who: i.name === i.phone ? formatPhoneClient(i.phone) : i.name, detail: `${dia(i.scheduledAt)} às ${hora(i.scheduledAt)}`, onConfirm: () => doMark(i, status) })
    : doMark(i, status));

  return (
    <section aria-label={ATTENDANCE_TITLE} className="shrink-0 border-b border-line bg-gold-soft/50 px-4">
      <h2 className="m-0">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls="conferir-lista"
          className="flex w-full min-h-11 lg:min-h-9 items-center justify-between gap-2 text-left text-xs font-semibold text-gold-ink">
          <span>{ATTENDANCE_TITLE} <span className="tabular">({list.length})</span></span>
          <span aria-hidden className={cn("text-xs transition-transform", open && "rotate-180")}>▼</span>
        </button>
      </h2>
      {/* No celular a frase fica só para leitor de tela: a altura vai para a primeira conversa da Fila, que tem de aparecer sem rolar. */}
      {open && <p className="-mt-1 pb-1 text-xs text-gold-ink/90 max-lg:sr-only">{ATTENDANCE_HELP}</p>}
      {open && <ul id="conferir-lista" className="flex max-h-[6.125rem] lg:max-h-56 flex-col overflow-y-auto overscroll-contain pb-2">
        <AnimatePresence initial={false}>
          {list.map((i) => {
            const name = i.name === i.phone ? formatPhoneClient(i.phone) : i.name;
            return (
              <motion.li key={i.dealId} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
                data-testid="conferir-item" className="flex flex-col gap-1 border-t border-line/70 py-1.5 first:border-t-0 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-2.5">
                {/* O nome nunca corta: quebra a linha. No computador, se não couber ao lado dos botões, os botões descem. */}
                <button type="button" onClick={() => openLead(i.dealId)} className="flex min-h-9 min-w-0 items-center gap-2.5 rounded-[var(--radius-control)] text-left lg:min-w-[9rem] lg:flex-1">
                  <ContactAvatar contactId={i.contactId} hasAvatar={i.hasAvatar} name={name} size={28} />
                  <span className="min-w-0">
                    <span className="block break-words text-sm font-medium leading-tight text-ink">{name}</span>
                    <span className="block text-xs text-graphite tabular">{dia(i.scheduledAt)} às {hora(i.scheduledAt)}</span>
                  </span>
                </button>
                <span className="flex gap-2 max-lg:pl-[38px]">
                {([["compareceu", "Veio", IconCheck], ["faltou", "Faltou", IconClose]] as const).map(([value, label, Icon]) => (
                  <button key={value} type="button" disabled={pending} onClick={() => mark(i, value)} aria-label={`${label}: ${name}`}
                    className={cn("inline-flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] border px-2.5 text-sm font-medium transition-colors disabled:opacity-60 lg:min-h-9",
                      value === "compareceu" ? "border-ok/40 bg-paper text-ok hover:bg-ok-soft" : "border-alert/40 bg-paper text-alert hover:bg-alert-soft")}>
                    <Icon size={14} aria-hidden />{label}
                  </button>
                ))}
                <button type="button" disabled={pending} aria-label={`Atrasada: ${name} (pergunta de novo em 30 min)`} title="Ainda não chegou: pergunta de novo em 30 min"
                  onClick={() => { const n = Date.now(); setNowMs(n); setLate((l) => ({ ...l, [i.dealId]: n + ATRASO_MS })); toast(`${name}: pergunto de novo em 30 min`); }}
                  className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-line-strong bg-paper px-2.5 text-sm font-medium text-graphite transition-colors hover:bg-paper-2 disabled:opacity-60 lg:min-h-9">
                  Atrasada
                </button>
                </span>
              </motion.li>
            );
          })}
        </AnimatePresence>
      </ul>}
    </section>
  );
}
