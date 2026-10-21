"use client";
import { useState } from "react";
import Link from "next/link";
import { isHiddenNumber } from "@/lib/phone-client";
import { can } from "@/lib/permissions";
import { AnimatePresence, motion } from "motion/react";
import type { Viewer } from "@/app/(app)/atendimento/actions";
import type { DealDetail } from "@/server/queries/deal";
import type { QueueItem } from "@/server/queries/queue";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { avatarVersion } from "@/lib/avatar-url";
import { Menu, type MenuItem } from "@/components/ui/menu";
import { useUrgencyLevel } from "@/components/pipeline/timer";
import { Elapsed } from "@/components/motion/elapsed";
import { IconClock, IconClose, IconMore, IconPhone } from "@/components/icons";
import { formatPhoneClient } from "@/lib/phone-client";
import { T, EASE } from "@/lib/motion";
import { cn } from "@/lib/cn";
import { WAIT_CLOCK_HELP, WAIT_CLOCK_PREFIX, waitClockSuffix } from "@/lib/alert-copy";
import { LATE_COLOR, retomarVencida, STATUS_LABEL, statusTone } from "@/lib/conversation-status";
import { RETOMAR_COLOR, RETOMAR_LABEL, retomarOf, statusItems, usePaneStatus } from "./status-menu";
import { firstName } from "@/lib/authorship";
import { BackToQueue } from "./queue-route";
import { ClientLink } from "@/components/contacts/client-link";
import { NameHeading } from "./name-heading";
import { kindMenuItems } from "./contact-kind-items";
import { KIND_LABEL } from "@/lib/contact-kind";
import { useToast } from "@/components/ui/toast";
import { followAction, markUnreadAction } from "@/app/(app)/conversa/actions";
import type { LeadActions } from "./use-lead-actions";

export type PaneBack = false | "below-lg" | "always";
/** Canais de WhatsApp que caíram, para o aviso compacto do celular (a conversa em tela cheia não mostra a faixa global). `href`: onde resolver. */
export type WaWarning = { down: { id: string; name: string }[]; href: string };

const URGENCY = { late: "bg-alert text-white", warn: "bg-gold-soft text-gold-ink", ok: "bg-paper-2 text-ink" } as const;

/**
 * Só as folhas `Elapsed` batem o relógio: o chip re-renderiza só quando a urgência muda e o resto do painel nunca por causa dele. Um chip só: "Esperando há 12 min (prazo 15)"
 * no desktop e só o tempo no celular (o CSS decide qual texto aparece, o relógio é o mesmo).
 */
function SlaChip({ since, slaMinutes, alert, hidden }: { since: string | null; slaMinutes: number | null; alert: boolean; hidden: boolean }) {
  const urgency = useUrgencyLevel(since, slaMinutes, alert);
  const show = !!since && !hidden;
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.span key="sla" title={WAIT_CLOCK_HELP} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: T.base, ease: EASE }}
          className={cn("inline-flex shrink-0 items-center gap-1.5 h-8 px-2.5 rounded-full text-sm font-semibold lg:hidden", URGENCY[urgency])}>
          <IconClock size={14} aria-hidden />
          {/* Celular: só o tempo (no computador o prazo está na linha da Fila e na Situação da cliente: uma informação por lugar). */}
          <span className="sr-only">{WAIT_CLOCK_PREFIX}</span><Elapsed since={since} sla={slaMinutes} alert={alert} /><span className="sr-only">{waitClockSuffix(slaMinutes)}</span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

const PILL = "h-8 pointer-coarse:min-h-11 px-2.5 inline-flex items-center gap-1.5 rounded-full text-sm font-medium text-ink-2 whitespace-nowrap";
const stageColor = (c?: string | null) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c! : "#5c5c5c");
const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
const yearOf = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { year: "numeric", timeZone: "America/Bahia" }) : null);

/**
 * A linha 2 do cabeçalho (nova organização, 16/10): ETAPA ▾ · STATUS ▾ (Aberto / Aguardando / Resolvido) · "Com: Sara" ▾ (abre "Passar para…")
 * e Assumir (dourado quando ninguém cuida). No celular é a faixa fina embaixo do nome.
 */
function HeaderControls({ d, viewer, actions }: { d: DealDetail; viewer: Viewer | null; actions: LeadActions }) {
  const { status, late } = usePaneStatus(d);
  const mayClose = can(viewer?.perms, "atendimento.fechar");
  // Perdido pede a permissão de fechar (e abre o motivo). Na Casa aparece (pedido do dono, 16/10).
  const stageItems: MenuItem[] = d.stages.filter((s) => s.key !== d.stage.key && s.kind !== "fechado" && s.kind !== "followup" && (mayClose || s.kind !== "perdido"))
    .map((s) => ({ label: s.name, onSelect: () => actions.moveTo(s.key) }));
  const owner = d.ownerName ? firstName(d.ownerName) ?? d.ownerName : "ninguém";
  const canTransfer = can(viewer?.perms, "atendimento.transferir");
  const mine = !!viewer && d.deal.ownerId === viewer.id;
  const c = stageColor(d.stage.color);
  const retomar = retomarOf(d, status);
  const venceu = retomar ? retomarVencida(d.nextAction?.dueAt ?? null) : null;
  const sc = retomar && !late ? (venceu ? LATE_COLOR : RETOMAR_COLOR) : statusTone(status, late);
  const statusText = late ? "Atrasado" : retomar ? `${RETOMAR_LABEL} · ${venceu ?? retomar}` : STATUS_LABEL[status];
  const ownerBody = (
    <>
      <span aria-hidden className={cn("grid size-[18px] place-items-center rounded-full text-xs font-bold", d.ownerName ? "bg-paper text-graphite" : "bg-gold-soft text-gold-ink")}>{d.ownerName ? initials(d.ownerName) : "?"}</span>
      <span data-testid="dona">Com: {owner}</span>
    </>
  );
  const stageBody = <span className={PILL} style={{ backgroundColor: `${c}1f`, boxShadow: `inset 0 0 0 1px ${c}59` }}><span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: c }} />{d.stage.name}<span aria-hidden className="text-xs text-muted">▾</span></span>;
  return (
    <div className="flex min-w-0 flex-nowrap items-center gap-1.5 lg:flex-wrap">
      {stageItems.length
        ? <Menu label={`Trocar etapa: ${d.stage.name}`} items={stageItems} align="left" triggerClassName="rounded-full p-0" trigger={stageBody} />
        : <span className={PILL} style={{ backgroundColor: `${c}1f` }}>{d.stage.name}</span>}
      <Menu label={`Status: ${retomar && !late ? `${RETOMAR_LABEL} · ${retomar}` : STATUS_LABEL[status]}${late ? ", passou do prazo" : ""}. Trocar status`} items={statusItems(status, actions, retomar)} align="left" triggerClassName="rounded-full p-0"
        trigger={<span data-testid="status-conversa" data-status={status} className={PILL} style={{ backgroundColor: `${sc}1a`, color: sc, boxShadow: `inset 0 0 0 1px ${sc}4d` }}>
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: sc }} /><span className="font-semibold">{statusText}</span><span aria-hidden className="text-xs opacity-70">▾</span></span>} />
      {canTransfer
        ? <button type="button" onClick={() => actions.open("passar")} aria-label={`Com ${d.ownerName ?? "ninguém"}. Passar para…`} className={cn(PILL, "bg-paper-2 hover:bg-paper-3")}>{ownerBody}<span aria-hidden className="text-xs text-muted">▾</span></button>
        : <span className={cn(PILL, "bg-paper-2")}>{ownerBody}</span>}
      {/* Resolver à vista (17/10: a Cati não achava o Resolvido, escondido no status ▾). A mesma ação do status → Resolvido. */}
      {status !== "resolvido" && !d.deal.closedAt && !d.deal.archivedAt && (
        <button type="button" disabled={actions.busy} onClick={() => actions.setStatus("resolvido")} title="Resolver a conversa: sai da lista e volta se ela escrever"
          className="h-8 pointer-coarse:min-h-11 rounded-[10px] border border-line-strong bg-paper px-3 text-sm font-semibold text-ink hover:border-ink disabled:opacity-60">Resolver</button>
      )}
      {viewer && !mine && (
        <button type="button" disabled={actions.busy} onClick={actions.claim}
          className={cn("h-8 pointer-coarse:min-h-11 rounded-[10px] px-3.5 text-sm font-semibold disabled:opacity-60", d.deal.ownerId ? "bg-ink text-paper hover:bg-ink-2" : "bg-gold-ink text-paper hover:brightness-110")}>Assumir</button>
      )}
    </div>
  );
}

/**
 * O cabeçalho da conversa em duas linhas (nova organização, 16/10). Linha 1: foto, nome, telefone, "ⓘ Cliente" (abaixo de 1280 px o painel
 * da cliente abre por ele), ⋯ e fechar. Linha 2: etapa, status, com quem está e Assumir. Aparece na hora com o que a Fila já sabe.
 */
export function PaneHeader({ item, d, name, answered, back, actions, viewer, wa, onClose, onInfo }: {
  item: QueueItem | null; d: DealDetail | null; name: string; answered: boolean; back: PaneBack;
  actions: LeadActions; viewer: Viewer | null; wa?: WaWarning; onClose: () => void;
  /** Abre o painel da cliente em tela cheia (celular e telas estreitas). */
  onInfo?: () => void;
}) {
  const toast = useToast();
  const [followNow, setFollowNow] = useState<boolean | null>(null);
  const following = followNow ?? d?.tools?.acompanhando ?? false;
  const phone = d?.contact.phoneE164 ?? item?.phone ?? "";
  /** Número oculto (@lid) não é discável: sem Ligar nem WhatsApp. */
  const dialable = phone && !isHiddenNumber(phone) ? phone : "";
  const contactId = d?.contact.id ?? item?.contactId ?? "";
  const hasAvatar = d ? !!d.contact.avatarPath : (item?.hasAvatar ?? false);
  // A mesma versão da Fila: a foto já baixada pela lista sai do cache do navegador (sem versão era outra URL, baixada de novo).
  const avatarV = item?.avatarV ?? (d ? avatarVersion(d.contact.avatarCheckedAt) : null);
  const kindNow = d?.contact.kind ?? item?.contactKind;
  const since = d ? (d.deal.awaitingReplySince ? new Date(d.deal.awaitingReplySince).toISOString() : null) : (item?.awaitingSince ?? null);
  const sla = d ? d.stage.slaMinutes : (item?.slaMinutes ?? null);
  const alert = d ? d.late : !!item?.alert;
  const waHref = `https://wa.me/${phone.replace(/\D/g, "")}`;
  const kind = d?.stage.kind;
  const mayClose = can(viewer?.perms, "atendimento.fechar"); // Recepção não marca perdido nem "não é cliente"
  const canLose = mayClose && !!kind && !["fechado", "perdido"].includes(kind);
  // Registrar ligação feita pelo celular (o WhatsApp não avisa): a mesma permissão de responder a conversa.
  const canLog = !!d && can(viewer?.perms, "atendimento.ver");
  const since0 = d ? (d.contact.isClient ? yearOf(d.context.knownSince ?? d.context.firstContactAt) : null) : null;

  // ⋯: o contato (Ligar, WhatsApp, e-mail, Instagram) e o que é raro (Perdido, tipo do contato). O resto está à vista.
  const toggleFollow = () => { if (!d) return; const next = !following; void followAction(d.deal.id, next).then((r) => { if (!r.ok) toast(r.error, "error"); else { setFollowNow(next); toast(next ? "Você está acompanhando esta conversa" : "Você deixou de acompanhar", "ok"); } }); };
  const unread = () => { if (!d) return; void markUnreadAction(d.deal.id).then((r) => { if (!r.ok) toast(r.error, "error"); else { toast("Marcada como não lida", "ok"); onClose(); } }); };
  const items: MenuItem[] = [
    ...(d?.tools?.acompanhar ? [{ label: following ? "Deixar de acompanhar" : "Acompanhar", onSelect: toggleFollow }] : []),
    ...(d?.tools?.naoLida ? [{ label: "Marcar como não lida", onSelect: unread }] : []),
    ...(dialable ? [{ label: "Ligar", onSelect: () => { window.location.href = `tel:${dialable}`; } }, { label: "WhatsApp", onSelect: () => { window.open(waHref, "_blank", "noopener,noreferrer"); } }] : []),
    ...(d?.contact.email ? [{ label: "E-mail", onSelect: () => { window.location.href = `mailto:${d.contact.email}`; } }] : []),
    ...(d?.contact.instagram ? [{ label: `@${d.contact.instagram}`, onSelect: () => { window.open(`https://instagram.com/${d.contact.instagram}`, "_blank", "noopener,noreferrer"); } }] : []),
    ...(canLog ? [{ label: "Registrar ligação", onSelect: () => actions.open("ligacao") }] : []),
    ...(d ? [{ label: "Editar dados da cliente", onSelect: () => actions.open("dados") }] : []),
    ...(canLose ? [{ label: "Marcar como perdido", danger: true, onSelect: () => actions.open("lose") }] : []),
    // "Marcar como…" (17/10): o mesmo menu do botão direito na Fila.
    ...(d && mayClose ? kindMenuItems(d.contact.kind, actions.setKind) : []),
  ];

  return (
    <>
      <div className="flex items-center gap-1 h-14 pl-1 pr-1.5 lg:h-auto lg:min-h-14 lg:gap-x-3 lg:px-4 lg:pt-2.5 lg:pb-1">
        <div className="flex items-center gap-1 lg:gap-0">
          {back && <BackToQueue compact className={back === "always" ? "lg:-ml-2" : "lg:hidden"} />}
          {contactId ? (
            <ClientLink contactId={contactId} name={name} label={`Ver ficha de ${name}`} className={cn("grid place-items-center rounded-full pointer-coarse:size-11", back ? undefined : "ml-2 lg:ml-0")}>
              <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} version={avatarV} name={name} size={40} />
            </ClientLink>
          ) : <ContactAvatar contactId={contactId} hasAvatar={hasAvatar} version={avatarV} name={name} size={40} className={back ? undefined : "ml-2 lg:ml-0"} />}
        </div>
        <div className="min-w-0 flex-1 ml-1.5 lg:ml-0">
          <div className="flex min-w-0 items-center gap-1">
            <NameHeading as="h2" name={name} contactId={contactId || undefined} className="line-clamp-1 text-base leading-tight font-semibold lg:text-[17px]" />
            {/* Selo discreto do tipo (Equipe, Fornecedor, Spam); cliente não tem selo. */}
            {kindNow && kindNow !== "cliente" && (
              <span data-testid="tipo-contato" className="shrink-0 rounded-full border border-line-strong px-1.5 text-xs font-medium leading-[18px] text-graphite">{KIND_LABEL[kindNow]}</span>
            )}
            {/* Telefone discreto (computador): registrar a ligação feita pelo celular. No celular, fica no ⋯. */}
            {canLog && (
              <button type="button" onClick={() => actions.open("ligacao")} title="Registrar ligação feita" aria-label="Registrar ligação feita"
                className="hidden lg:grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-paper-2 hover:text-ink">
                <IconPhone size={15} aria-hidden />
              </button>
            )}
          </div>
          <p className="hidden lg:block text-xs text-graphite mt-0.5 truncate">{formatPhoneClient(phone)}{since0 ? ` · Cliente desde ${since0}` : ""}</p>
        </div>
        <SlaChip since={since} slaMinutes={sla} alert={alert} hidden={answered} />
        {onInfo && d && (
          <button type="button" onClick={onInfo} className="xl:hidden inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-sm font-medium text-ink hover:bg-paper-2 pointer-coarse:min-h-11" aria-label="Ver dados da cliente">
            <span aria-hidden className="grid size-4 place-items-center rounded-full border border-current text-xs font-bold leading-none">i</span>Cliente
          </button>
        )}
        {items.length > 0 && <Menu label="Mais ações" trigger={<IconMore size={18} />} items={items} triggerClassName="size-9 pointer-coarse:size-11" />}
        <button type="button" onClick={onClose} className="hidden lg:grid size-8 pointer-coarse:size-11 place-items-center rounded-[var(--radius-control)] text-muted hover:bg-paper-2 hover:text-ink" aria-label="Fechar conversa"><IconClose /></button>
      </div>
      {d && (
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-1.5 [scrollbar-width:none] lg:px-4 lg:pb-2.5" data-testid="faixa-conversa">
          <HeaderControls d={d} viewer={viewer} actions={actions} />
        </div>
      )}

      {/* Celular: a conversa em tela cheia não tem a faixa global de conexão; o aviso fica aqui, numa linha só, e leva a quem resolve. */}
      {wa && wa.down.length > 0 && (
        <Link href={wa.href} data-testid="aviso-whatsapp" title={wa.down.map((c) => c.name).join(", ")}
          className="lg:hidden relative flex h-9 items-center justify-center gap-2 border-t border-alert/20 bg-alert-soft text-xs font-semibold text-alert before:absolute before:inset-x-0 before:-inset-y-1.5">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-alert" />WhatsApp desconectado<span className="font-normal underline underline-offset-2">ver</span>
        </Link>
      )}
    </>
  );
}
