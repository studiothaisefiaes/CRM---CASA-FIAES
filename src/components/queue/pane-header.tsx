"use client";
import { AnimatePresence, motion } from "motion/react";
import type { DealDetail } from "@/server/queries/deal";
import type { QueueItem } from "@/server/queries/queue";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { Badge } from "@/components/ui/badge";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useUrgency } from "@/components/pipeline/timer";
import { IconClock, IconClose, IconInstagram, IconMail, IconMore, IconPhone, IconWhatsApp } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";
import { money, PAYMENT_LABEL } from "@/lib/format";
import { DUR, EASE, SPRING } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { BackToQueue } from "./queue-route";

export type PaneTab = "conversa" | "dados" | "historico";
export type PaneBack = false | "below-lg" | "always";

const URGENCY = { late: "bg-alert text-white", warn: "bg-gold-soft text-gold-ink", ok: "bg-paper-2 text-ink" } as const;

/** Só este pedaço bate o relógio (a cada segundo): o resto do painel não re-renderiza por causa dele. */
function SlaChip({ since, slaMinutes, hidden, compact }: { since: string | null; slaMinutes: number | null; hidden: boolean; compact?: boolean }) {
  const { urgency, label } = useUrgency(since, slaMinutes);
  const show = !!label && !hidden;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span key="sla" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE }}
          aria-label={`Esperando resposta há ${label}${slaMinutes ? `, prazo de ${slaMinutes} min` : ""}`} suppressHydrationWarning
          className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold", URGENCY[urgency], compact ? "h-8 px-2.5 text-sm" : "mt-3 h-8 px-3 text-sm")}>
          <IconClock size={14} aria-hidden />
          <span aria-hidden suppressHydrationWarning>{compact ? label : `Esperando resposta há ${label}`}</span>
          {!compact && slaMinutes ? <span aria-hidden className="font-normal opacity-80">· prazo {slaMinutes} min</span> : null}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

const ACTION = "h-9 pointer-coarse:min-h-11 px-3 inline-flex items-center gap-1.5 rounded-[var(--radius-control)] text-sm";
const OUTLINE = `${ACTION} border border-line-strong hover:bg-paper-2`;

/**
 * O cabeçalho da conversa. Aparece na hora com o que o item da Fila já sabe (nome, foto, etapa, espera) e se completa quando o lead chega.
 * Celular: uma linha (voltar, nome, espera, ⋯ com as ações) e abas embaixo. Desktop: nome, contato, espera e as ações à vista.
 */
export function PaneHeader({ item, d, name, answered, back, tab, onTab, onMove, onClose }: {
  item: QueueItem | null; d: DealDetail | null; name: string; answered: boolean; back: PaneBack; tab: PaneTab; onTab: (t: PaneTab) => void;
  onMove: (stageKey: string) => void; onClose: () => void;
}) {
  const phone = d?.contact.phoneE164 ?? item?.phone ?? "";
  const contactId = d?.contact.id ?? item?.contactId ?? "";
  const hasAvatar = d ? !!d.contact.avatarPath : (item?.hasAvatar ?? false);
  const since = d ? (d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).toISOString() : null) : (item?.awaitingSince ?? null);
  const sla = d ? d.stage.slaMinutes : (item?.slaMinutes ?? null);
  const origin = d?.deal.origin ?? item?.sourceLabel ?? "";
  const wa = `https://wa.me/${phone.replace(/\D/g, "")}`;
  const kind = d?.stage.kind;
  const canSchedule = !!kind && ["lead", "atendimento", "followup"].includes(kind);
  const canClose = kind === "agendado";
  const canLose = !!kind && !["fechado", "perdido"].includes(kind);

  const items: MenuItem[] = [
    ...(canSchedule ? [{ label: "Agendar", onSelect: () => onMove("agendado") }] : []),
    ...(canClose ? [{ label: "Fechar venda", onSelect: () => onMove("fechado") }] : []),
    ...(canLose ? [{ label: "Perdido", danger: true, onSelect: () => onMove("perdido") }] : []),
    ...(phone ? [{ label: "Ligar", onSelect: () => { window.location.href = `tel:${phone}`; } }, { label: "WhatsApp", onSelect: () => { window.open(wa, "_blank", "noopener,noreferrer"); } }] : []),
    ...(d?.contact.email ? [{ label: "E-mail", onSelect: () => { window.location.href = `mailto:${d.contact.email}`; } }] : []),
    ...(d?.contact.instagram ? [{ label: `@${d.contact.instagram}`, onSelect: () => { window.open(`https://instagram.com/${d.contact.instagram}`, "_blank", "noopener,noreferrer"); } }] : []),
    // As etapas que já têm botão próprio (agendar, fechar, perdido) não se repetem na lista.
    ...(d ? d.stages.filter((s) => s.key !== d.stage.key && !(canSchedule && s.key === "agendado") && !(canClose && s.key === "fechado") && !(canLose && s.key === "perdido")).map((s) => ({ label: `Mover para ${s.name}`, onSelect: () => onMove(s.key) })) : []),
  ];

  return (
    <>
      {/* Celular e janela estreita: uma linha só */}
      <div className="lg:hidden flex items-center gap-1 h-14 pl-1 pr-1.5">
        {back && <BackToQueue compact />}
        <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} name={name} size={32} className={back ? undefined : "ml-2"} />
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold ml-1.5">{name}</h2>
        <SlaChip since={since} slaMinutes={sla} hidden={answered} compact />
        <Menu label="Mais ações" trigger={<IconMore size={20} />} items={items} triggerClassName="size-11" />
      </div>

      {/* Desktop */}
      <div className="hidden lg:block px-5 pt-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3.5">
            {back === "always" && <BackToQueue compact className="-ml-2" />}
            <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} name={name} size={44} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-serif text-[28px] leading-tight font-light truncate">{name}</h2>
                {d?.contact.isClient && <Badge tone="ok">Cliente</Badge>}
              </div>
              <p className="text-sm text-graphite mt-0.5 truncate">{formatPhoneClient(phone)}{origin ? ` · ${origin}` : ""}{d?.channelName ? ` · ${d.channelName}` : ""}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="size-9 pointer-coarse:size-11 grid place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper-2 hover:text-ink" aria-label="Fechar conversa"><IconClose /></button>
        </div>
        <SlaChip since={since} slaMinutes={sla} hidden={answered} />
        <div className="flex items-center gap-2 mt-3 flex-wrap min-h-9">
          {d ? (
            <label className="relative">
              <span className="sr-only">Etapa</span>
              <select aria-label="Etapa" value={d.stage.key} onChange={(e) => onMove(e.target.value)} className="h-9 pointer-coarse:min-h-11 pl-3 pr-8 rounded-[var(--radius-control)] border border-line-strong bg-paper text-sm font-medium appearance-none cursor-pointer hover:bg-paper-2">
                {d.stages.map((s) => <option key={s.id} value={s.key}>{s.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted text-[10px]">▼</span>
            </label>
          ) : (
            <span className="h-9 px-3 inline-flex items-center rounded-[var(--radius-control)] border border-line text-sm font-medium text-graphite">{item?.stageName ?? ""}</span>
          )}
          {canSchedule && <button type="button" onClick={() => onMove("agendado")} className={`${ACTION} bg-ink text-paper font-medium hover:bg-ink-2`}>Agendar</button>}
          {canClose && <button type="button" onClick={() => onMove("fechado")} className={`${ACTION} bg-ok text-white font-medium hover:brightness-110`}>Fechar venda</button>}
          {canLose && <button type="button" onClick={() => onMove("perdido")} className={`${ACTION} text-alert hover:bg-alert-soft`}>Perdido</button>}
          {phone && (
            <>
              <span className="w-px h-6 bg-line mx-1 hidden sm:block" aria-hidden />
              <a href={`tel:${phone}`} className={OUTLINE}><IconPhone size={15} />Ligar</a>
              <a href={wa} target="_blank" rel="noreferrer" className={OUTLINE}><IconWhatsApp size={15} />WhatsApp</a>
            </>
          )}
          {d?.contact.email && <a href={`mailto:${d.contact.email}`} className={OUTLINE}><IconMail size={15} />E-mail</a>}
          {d?.contact.instagram && <a href={`https://instagram.com/${d.contact.instagram}`} target="_blank" rel="noreferrer" className={OUTLINE}><IconInstagram size={15} />@{d.contact.instagram}</a>}
          {d && d.deal.valueCents != null && <Badge tone="ok" className="ml-auto">{money(d.deal.valueCents)}{d.deal.paymentMethod ? ` · ${PAYMENT_LABEL[d.deal.paymentMethod]}` : ""}</Badge>}
        </div>
      </div>

      {/* Abaixo de 1280 px o cliente não cabe ao lado: abas Conversa | Dados | Histórico */}
      <div className="xl:hidden flex border-t border-line" role="tablist" aria-label="Partes do lead">
        {(["conversa", "dados", "historico"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => onTab(t)}
            className={cn("relative flex-1 min-h-11 text-sm font-medium transition-colors", tab === t ? "text-ink" : "text-graphite hover:text-ink")}>
            {tab === t && <motion.span layoutId="pane-tab" transition={SPRING} className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-ink" />}
            {t === "conversa" ? "Conversa" : t === "dados" ? "Dados" : "Histórico"}
          </button>
        ))}
      </div>
    </>
  );
}
