"use client";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import type { Viewer } from "@/app/(app)/atendimento/actions";
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
import type { LeadActions } from "./use-lead-actions";

export type PaneTab = "conversa" | "dados" | "historico";
export type PaneBack = false | "below-lg" | "always";
/** Canais de WhatsApp que caíram, para o aviso compacto do celular (a conversa em tela cheia não mostra a faixa global). `href`: onde resolver. */
export type WaWarning = { down: { id: string; name: string }[]; href: string };

const URGENCY = { late: "bg-alert text-white", warn: "bg-gold-soft text-gold-ink", ok: "bg-paper-2 text-ink" } as const;

/**
 * Só este pedaço bate o relógio (a cada segundo): o resto do painel não re-renderiza por causa dele. Um chip só: no celular é a espera curta
 * ao lado do nome; no desktop vira a linha "Esperando resposta há … · prazo …" (o CSS decide qual texto aparece, o relógio é o mesmo).
 */
function SlaChip({ since, slaMinutes, hidden }: { since: string | null; slaMinutes: number | null; hidden: boolean }) {
  const { urgency, label } = useUrgency(since, slaMinutes);
  const show = !!label && !hidden;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span key="sla" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE }}
          aria-label={`Esperando resposta há ${label}${slaMinutes ? `, prazo de ${slaMinutes} min` : ""}`} suppressHydrationWarning
          className={cn("inline-flex shrink-0 items-center gap-1.5 h-8 px-2.5 lg:px-3 rounded-full text-sm font-semibold lg:col-span-3 lg:row-start-2 lg:justify-self-start lg:mt-3", URGENCY[urgency])}>
          <IconClock size={14} aria-hidden />
          <span aria-hidden suppressHydrationWarning>
            <span className="lg:hidden" suppressHydrationWarning>{label}</span>
            <span className="hidden lg:inline" suppressHydrationWarning>Esperando resposta há {label}</span>
          </span>
          {slaMinutes ? <span aria-hidden className="hidden lg:inline font-normal opacity-80">· prazo {slaMinutes} min</span> : null}
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
export function PaneHeader({ item, d, name, answered, back, tab, onTab, actions, viewer, wa, onClose }: {
  item: QueueItem | null; d: DealDetail | null; name: string; answered: boolean; back: PaneBack; tab: PaneTab; onTab: (t: PaneTab) => void;
  actions: LeadActions; viewer: Viewer | null; wa?: WaWarning; onClose: () => void;
}) {
  const phone = d?.contact.phoneE164 ?? item?.phone ?? "";
  const contactId = d?.contact.id ?? item?.contactId ?? "";
  const hasAvatar = d ? !!d.contact.avatarPath : (item?.hasAvatar ?? false);
  const since = d ? (d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).toISOString() : null) : (item?.awaitingSince ?? null);
  const sla = d ? d.stage.slaMinutes : (item?.slaMinutes ?? null);
  const origin = d?.sourceLabel ?? item?.sourceLabel ?? "";
  const waHref = `https://wa.me/${phone.replace(/\D/g, "")}`;
  const kind = d?.stage.kind;
  const canSchedule = !!kind && ["lead", "atendimento", "followup"].includes(kind);
  const canClose = kind === "agendado";
  const canSell = !!kind && !["fechado", "perdido"].includes(kind);
  const canLose = !!kind && !["fechado", "perdido"].includes(kind);
  const notMine = !!d && !!viewer && d.deal.ownerId !== viewer.id;

  const items: MenuItem[] = [
    ...(notMine ? [{ label: "Assumir", onSelect: actions.claim }] : []),
    ...(canSchedule ? [{ label: "Agendar", onSelect: () => actions.open("schedule") }] : []),
    ...(canSell ? [{ label: "Fechar venda", onSelect: () => actions.open("close") }] : []),
    ...(canClose ? [{ label: "Remarcar", onSelect: () => actions.open("schedule") }] : []),
    ...(canLose ? [{ label: "Perdido", danger: true, onSelect: () => actions.open("lose") }] : []),
    ...(phone ? [{ label: "Ligar", onSelect: () => { window.location.href = `tel:${phone}`; } }, { label: "WhatsApp", onSelect: () => { window.open(waHref, "_blank", "noopener,noreferrer"); } }] : []),
    ...(d?.contact.email ? [{ label: "E-mail", onSelect: () => { window.location.href = `mailto:${d.contact.email}`; } }] : []),
    ...(d?.contact.instagram ? [{ label: `@${d.contact.instagram}`, onSelect: () => { window.open(`https://instagram.com/${d.contact.instagram}`, "_blank", "noopener,noreferrer"); } }] : []),
    // As etapas que já têm botão próprio (agendar, fechar, perdido) não se repetem na lista.
    ...(d ? d.stages.filter((s) => s.key !== d.stage.key && !(canSchedule && s.key === "agendado") && !(canSell && s.key === "fechado") && !(canLose && s.key === "perdido")).map((s) => ({ label: `Mover para ${s.name}`, onSelect: () => actions.moveTo(s.key) })) : []),
    ...(d && canLose ? [{ label: "Não é cliente", danger: true, onSelect: actions.notClient }] : []),
  ];

  return (
    <>
      {/* Uma estrutura só. Celular: uma linha (voltar, foto, nome, espera, ⋯). Desktop (lg): grade com foto, nome e contato, a linha da espera e as ações à vista. */}
      <div className="flex items-center gap-1 h-14 pl-1 pr-1.5 lg:grid lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start lg:gap-x-3.5 lg:gap-y-0 lg:h-auto lg:px-5 lg:pt-3 lg:pb-3">
        <div className="flex items-center gap-1 lg:gap-0">
          {back && <BackToQueue compact className={back === "always" ? "lg:-ml-2" : "lg:hidden"} />}
          <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} name={name} size={40} className={back ? undefined : "ml-2 lg:ml-0"} />
        </div>
        <div className="min-w-0 flex-1 lg:flex-none ml-1.5 lg:ml-0">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold lg:font-serif lg:text-[28px] lg:leading-tight lg:font-light">{name}</h2>
            {d?.contact.isClient && <Badge tone="ok" className="hidden lg:inline-flex">Cliente</Badge>}
          </div>
          <p className="hidden lg:block text-sm text-graphite mt-0.5 truncate">{formatPhoneClient(phone)}{origin ? ` · ${origin}` : ""}{d?.channelName ? ` · ${d.channelName}` : ""}</p>
        </div>
        <SlaChip since={since} slaMinutes={sla} hidden={answered} />
        <Menu label="Mais ações" trigger={<IconMore size={20} />} items={items} className="lg:hidden" triggerClassName="size-11" />
        <button type="button" onClick={onClose} className="hidden lg:grid size-9 pointer-coarse:size-11 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper-2 hover:text-ink" aria-label="Fechar conversa"><IconClose /></button>

        {/* Ações à vista (desktop); no celular moram no menu ⋯ */}
        <div className="hidden lg:flex items-center gap-2 mt-3 flex-wrap min-h-9 lg:col-span-3">
          {/* A etapa e as ações moram no painel do cliente (≥ 1280 px); abaixo disso ficam aqui. */}
          <span className="h-9 px-3 inline-flex items-center rounded-full border border-line text-sm font-medium text-graphite">{d?.stage.name ?? item?.stageName ?? ""}</span>
          {canSchedule && <button type="button" onClick={() => actions.open("schedule")} className={`${ACTION} xl:hidden bg-ink text-paper font-medium hover:bg-ink-2`}>Agendar</button>}
          {canSell && <button type="button" onClick={() => actions.open("close")} className={`${ACTION} xl:hidden bg-ok text-white font-medium hover:brightness-110`}>Fechar venda</button>}
          {canLose && <button type="button" onClick={() => actions.open("lose")} className={`${ACTION} xl:hidden text-alert hover:bg-alert-soft`}>Perdido</button>}
          {phone && (
            <>
              <span className="w-px h-6 bg-line mx-1 hidden sm:block" aria-hidden />
              <a href={`tel:${phone}`} className={OUTLINE}><IconPhone size={15} />Ligar</a>
              <a href={waHref} target="_blank" rel="noreferrer" className={OUTLINE}><IconWhatsApp size={15} />WhatsApp</a>
            </>
          )}
          {d?.contact.email && <a href={`mailto:${d.contact.email}`} className={OUTLINE}><IconMail size={15} />E-mail</a>}
          {d?.contact.instagram && <a href={`https://instagram.com/${d.contact.instagram}`} target="_blank" rel="noreferrer" className={OUTLINE}><IconInstagram size={15} />@{d.contact.instagram}</a>}
          {d && d.deal.valueCents != null && <Badge tone="ok" className="ml-auto">{money(d.deal.valueCents)}{d.deal.paymentMethod ? ` · ${PAYMENT_LABEL[d.deal.paymentMethod]}` : ""}</Badge>}
        </div>
      </div>

      {/* Celular: a conversa em tela cheia não tem a faixa global de conexão; o aviso fica aqui, numa linha só, e leva a quem resolve. */}
      {wa && wa.down.length > 0 && (
        <Link href={wa.href} data-testid="aviso-whatsapp" title={wa.down.map((c) => c.name).join(", ")}
          className="lg:hidden relative flex h-9 items-center justify-center gap-2 border-t border-alert/20 bg-alert-soft text-xs font-semibold text-alert before:absolute before:inset-x-0 before:-inset-y-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-alert" />WhatsApp desconectado<span className="font-normal underline underline-offset-2">ver</span>
        </Link>
      )}

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
