"use client";
import { PAUSED_BADGE } from "@/lib/consent";
import { StageBadge } from "@/components/ui/stage-badge";
import Link from "next/link";
import { memo, useRef, type MouseEvent } from "react";
import type { QueueItem } from "@/server/queries/queue";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconCheck, IconMic, IconPhone } from "@/components/icons";
import { useClock, useHours } from "@/components/pipeline/timer";
import { formatPhoneClient } from "@/lib/phone-client";
import { lateNow, type QueueSectionKey } from "@/lib/queue";
import { lastMessageTime } from "@/lib/alert-copy";
import { conversationStatus, STATUS_HINT, STATUS_LABEL, statusTone, LATE_COLOR, RETOMAR_COLOR, RETOMAR_LABEL, retomarVencida, retomarWhen } from "@/lib/conversation-status";
import { displayName } from "@/lib/display-name";
import { cn } from "@/lib/cn";
import { lastMessagePrefix } from "@/lib/authorship";
import { stripSignature } from "@/lib/signature";
import { audioPreview } from "@/lib/audio";
import { prefetchConversation } from "./conversation-cache";

/** Pré-busca a conversa quando o mouse PARA no item (passar por cima rolando a lista não dispara) ou o item ganha foco. */
const HOVER_INTENT_MS = 80;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
const intent = (dealId: string) => { clearTimeout(hoverTimer); hoverTimer = setTimeout(() => prefetchConversation(dealId), HOVER_INTENT_MS); };
const noIntent = () => clearTimeout(hoverTimer);

const KIND: Record<string, string> = { text: "Mensagem", call: "Ligação", audio: "Áudio", image: "Foto", sticker: "Figurinha", video: "Vídeo", document: "Documento", location: "Localização", contact: "Contato", poll: "Enquete", event: "Evento", other: "Mensagem" };

/** Só em teste: quantas vezes o corpo de um item da Fila rodou (prova que o relógio não re-renderiza as linhas). */
export const __itemRenderCount = { value: 0 };
function countRender() { if (process.env.NODE_ENV === "test") __itemRenderCount.value++; }

/** Folha da hora da última mensagem ("09:31", "ontem", "13/10"): só muda na virada do dia, a linha não re-renderiza. Com não lidas, verde (como no WhatsApp). */
function RowHour({ at, unread }: { at: number; unread: boolean }) {
  const text = useClock((now) => lastMessageTime(at, now));
  return <span data-hora="" suppressHydrationWarning className={cn("shrink-0 text-xs tabular", unread ? "text-ok font-semibold" : "text-muted")}>{text}</span>;
}

/**
 * Folha do status (cartão fino, pedido do dono 16/10): a pílula Aberto / Aguardando / Resolvido e o traço colorido da borda esquerda.
 * Só ela escuta o relógio (Aberto vira vermelho ao passar do prazo); a linha não re-renderiza.
 */
function RowStatusPill({ item, since }: { item: QueueItem; since: number | null }) {
  const hours = useHours();
  const status = conversationStatus({ archivedAt: item.resolved ? "x" : null, awaitingSince: item.awaitingSince });
  const late = useClock((now) => status === "aberto" && lateNow({ alert: !!item.alert, since, slaMinutes: item.slaMinutes }, now, hours), since ?? 0);
  const retomar = retomarWhen({ awaitingSince: item.awaitingSince, dueAt: item.nextAction?.dueAt ?? null, lastAt: item.lastAt });
  const venceu = retomar ? retomarVencida(item.nextAction?.dueAt ?? null) : null;
  const c = retomar && !late ? (venceu ? LATE_COLOR : RETOMAR_COLOR) : statusTone(status, late);
  return (
    <>
      <span aria-hidden data-traco="" className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: c }} />
      <span data-status={retomar ? "retomar" : status} data-atrasado={late ? "" : undefined} title={late ? "Passou do prazo de resposta" : retomar ? `Voltar a falar ${retomar}` : STATUS_HINT[status]}
        className="inline-flex h-4 shrink-0 items-center gap-1 rounded-full px-1.5 text-xs font-semibold leading-4"
        style={{ backgroundColor: `${c}1a`, color: c, boxShadow: `inset 0 0 0 1px ${c}4d` }}>
        <span aria-hidden className="size-1.5 rounded-full" style={{ backgroundColor: c }} />{late ? "Atrasado" : retomar ? `${RETOMAR_LABEL} · ${venceu ?? retomar}` : STATUS_LABEL[status]}
      </span>
    </>
  );
}

/** Cartão fino (pedido do dono, 16/10): ~64 px, foto pequena, nome e hora; a prévia; a etapa e o status. Nada de sinais, dona ou prazo escrito. */
const AVATAR = 36;

/**
 * Seleção em massa de um item, em valores simples (e um callback estável) para o `memo` da linha valer: um objeto novo a cada render
 * da lista faria todas as linhas re-renderizarem. `selecting` ligado: tocar marca em vez de abrir.
 */
export type RowSelection = { selectable: boolean; selecting: boolean; checked: boolean; onSelect: (dealId: string, range: boolean) => void };

/** A caixinha de marcar. Só desenho (aria-hidden): quem marca é a própria linha (`option` com `aria-selected`), por Espaço ou toque. */
function Box({ checked, size = 22 }: { checked: boolean; size?: number }) {
  return (
    <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-[6px] border-2 transition-colors", checked ? "border-ink bg-ink text-paper" : "border-graphite bg-paper")} style={{ width: size, height: size }}>
      {checked && <IconCheck size={size - 8} strokeWidth={3} />}
    </span>
  );
}

/** Toque longo no celular: segurar o dedo parado por este tempo abre o "Marcar como…" (como o botão direito no computador). */
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE = 10;

export const QueueRow = memo(function QueueRow({ item, section, selected, href, tabIndex, onOpen, onStageTap, onKindMenu, unread = 0, selectable = false, selecting = false, checked = false, onSelect }: {
  item: QueueItem; section: QueueSectionKey; selected: boolean; href: string; tabIndex: number; onOpen?: (item: QueueItem, e: MouseEvent<HTMLAnchorElement>) => void;
  /** Botão direito (ou toque longo) na linha: "Marcar como…" Cliente, Equipe, Fornecedor, Spam, onde tocou. */ onKindMenu?: (item: QueueItem, at: { x: number; y: number }) => void;
  /** Mensagens da cliente que ninguém abriu (contador pequeno à direita; 0 = lida). */ unread?: number;
  /** Tocar na etiqueta da etapa: troca a etapa ali mesmo (a Fila abre o menu das etapas). */ onStageTap?: (item: QueueItem) => void;
} & Partial<RowSelection>) {
  countRender();
  void section;
  const since = item.awaitingSince ? new Date(item.awaitingSince).getTime() : null;
  const name = item.name === item.phone ? formatPhoneClient(item.phone) : displayName(item.name);
  // Áudio: "Áudio (0:42): começo da transcrição…".
  const snippet = (item.lastMessage ? stripSignature(item.lastMessage) : "")
    || (item.lastKind === "audio" ? audioPreview(item.lastDurationSec, item.lastTranscript) : item.lastKind ? KIND[item.lastKind] ?? null : null);
  const prefix = lastMessagePrefix(item.lastDirection, item.lastAuthorName, item.lastMessage);
  const on = selecting ? checked : selected;
  const press = useRef<{ x: number; y: number; t: ReturnType<typeof setTimeout> } | null>(null);
  const pressed = useRef(false); // o toque longo abriu o menu: o "clique" que vem ao soltar não abre a conversa
  const cancelPress = () => { if (press.current) clearTimeout(press.current.t); press.current = null; };
  const kindMenu = onKindMenu && !selecting;
  return (
    <Link href={href} prefetch={false} scroll={false} role="option" aria-selected={on} tabIndex={tabIndex} data-deal-id={item.dealId}
      onClick={(e) => {
        if (pressed.current) { pressed.current = false; e.preventDefault(); return; }
        if (selecting) { e.preventDefault(); onSelect?.(item.dealId, e.shiftKey); return; }
        onOpen?.(item, e);
      }}
      onMouseEnter={selecting ? undefined : () => intent(item.dealId)} onMouseLeave={noIntent}
      onFocus={selecting ? undefined : () => prefetchConversation(item.dealId)}
      // Celular: o toque começa a buscar a conversa antes do clique (que ainda espera a tela nova do servidor).
      onTouchStart={selecting ? undefined : (e) => {
        prefetchConversation(item.dealId);
        if (!kindMenu || e.touches.length !== 1) return;
        const { clientX: x, clientY: y } = e.touches[0];
        cancelPress();
        press.current = { x, y, t: setTimeout(() => { press.current = null; pressed.current = true; onKindMenu(item, { x, y }); }, LONG_PRESS_MS) };
      }}
      onTouchMove={kindMenu ? (e) => { const p = press.current, t = e.touches[0]; if (p && t && Math.hypot(t.clientX - p.x, t.clientY - p.y) > LONG_PRESS_MOVE) cancelPress(); } : undefined}
      onTouchEnd={kindMenu ? cancelPress : undefined} onTouchCancel={kindMenu ? cancelPress : undefined}
      onContextMenu={kindMenu ? (e) => { e.preventDefault(); cancelPress(); onKindMenu(item, { x: e.clientX, y: e.clientY }); } : undefined}
      className={cn(
        "group relative flex items-center gap-2.5 py-1 pl-3.5 pr-3 min-h-16 border-b border-line/80 outline-offset-[-2px] scroll-mt-2 scroll-mb-2 transition-colors [-webkit-touch-callout:none]",
        on ? "bg-gold-soft/60 hover:bg-gold-soft/80" : "hover:bg-paper-2",
      )}>
      {selecting && <span aria-hidden data-testid="item-caixa" className="-ml-1.5 -mr-1 grid size-11 shrink-0 place-items-center self-center"><Box checked={checked} /></span>}
      <span className="group/foto relative shrink-0 self-start mt-0.5">
        <ContactAvatar contactId={item.contactId} hasAvatar={item.hasAvatar} version={item.avatarV} name={name} size={AVATAR} />
        {/* Desktop: a caixinha aparece sobre a foto ao passar o mouse NA FOTO (ou focar o item pelo teclado). No celular a seleção entra por "Selecionar". */}
        {selectable && !selecting && (
          <span aria-hidden data-testid="item-selecionar" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onSelect?.(item.dealId, e.shiftKey); }}
            className={cn("absolute inset-0 hidden place-items-center rounded-full bg-paper/80 opacity-0 transition-opacity group-hover/foto:opacity-100 pointer-fine:grid",
              !selected && "group-focus-visible:opacity-100")}><Box checked={false} size={20} /></span>
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-2">
          <span data-nome="" className="truncate text-sm font-semibold leading-[18px]">{name}</span>
          {item.lastAt && <RowHour at={new Date(item.lastAt).getTime()} unread={unread > 0} />}
        </span>
        <span className="flex items-center justify-between gap-2">
          <span className={cn("block min-w-0 truncate text-sm leading-[17px]", item.lastDirection === "in" ? "text-ink-2" : "text-graphite")}>
            {item.lastKind === "audio" && <IconMic size={12} className="inline -mt-0.5 mr-1" />}
            {item.lastKind === "call" && <IconPhone size={12} className="inline -mt-0.5 mr-1" aria-hidden />}
            {prefix && <span className="text-muted">{prefix}</span>}{snippet || <span className="text-muted">Sem mensagens ainda</span>}
          </span>
          {unread > 0 && (
            <>
              <span aria-hidden data-nao-lidas="" className="grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full bg-ok px-1 text-xs font-bold leading-none text-white tabular">{unread > 99 ? "99+" : unread}</span>
              <span className="sr-only">{unread} {unread === 1 ? "não lida" : "não lidas"}</span>
            </>
          )}
        </span>
        <span className="mt-0.5 flex h-4 min-w-0 items-center gap-1.5">
          <StageBadge name={item.stageName} color={item.stageColor} title={onStageTap && !selecting ? "Trocar a etapa" : undefined} className="h-4 py-0 text-xs leading-4"
            onClick={onStageTap && !selecting ? (e) => { e.preventDefault(); e.stopPropagation(); onStageTap(item); } : undefined} />
          <RowStatusPill item={item} since={since} />
          {item.badges?.includes(PAUSED_BADGE) && <span className="shrink-0 truncate text-xs leading-4 text-muted">{PAUSED_BADGE}</span>}
        </span>
      </span>
    </Link>
  );
});
