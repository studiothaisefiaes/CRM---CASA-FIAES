"use client";
import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import type { ContactRow } from "@/server/queries/contacts";
import { Badge } from "@/components/ui/badge";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { IconCheck } from "@/components/icons";
import { useQueueSelection } from "@/components/queue/queue-selection";
import { ContactsBulkBar } from "./contacts-bulk-bar";
import { Highlight } from "./highlight";
import { formatPhoneClient } from "@/lib/phone-client";
import { displayName as titleName } from "@/lib/display-name";
import { dueLabel } from "@/lib/next-action";
import { useClock } from "@/components/pipeline/timer";
import { cn } from "@/lib/cn";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Bahia" });

// `compact` (cartão do celular): rótulo curto, para o nome não ser cortado
function StatusBadge({ c, compact }: { c: ContactRow; compact?: boolean }) {
  if (c.ignored) return <Badge className="border border-line-strong">Não é cliente</Badge>;
  if (c.isClient) return <Badge tone="ok">Cliente{c.clientSince && !compact ? ` desde ${new Date(c.clientSince).getFullYear()}` : ""}</Badge>;
  // r68 #13: "Atendendo" em quase toda linha virava ruído; a situação ao lado já diz em que pé está. Etiqueta só quando muda o que fazer.
  return null;
}

function Box({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={cn("grid size-[22px] shrink-0 place-items-center rounded-[6px] border-2 transition-colors", checked ? "border-ink bg-ink text-paper" : "border-graphite bg-paper")}>
      {checked && <IconCheck size={14} strokeWidth={3} />}
    </span>
  );
}

/** O trecho da mensagem em que a busca achou o contato, com o termo destacado (texto puro, sem HTML). */
function Snippet({ c, term, lines = 2 }: { c: ContactRow; term: string; lines?: 1 | 2 }) {
  if (!c.snippet) return null;
  return (
    <span className={cn("mt-1 flex gap-1.5 text-sm text-graphite", lines === 1 ? "line-clamp-1" : "line-clamp-2")}>
      <span className="sr-only">Mensagem encontrada em {shortDate(c.snippet.at)}: </span>
      <span aria-hidden className="shrink-0 text-gold">“</span>
      <span className="min-w-0"><Highlight text={c.snippet.text} term={term} /></span>
    </span>
  );
}

/**
 * A lista de Contatos: cartões no celular e tabela a partir de 640 px. Com a seleção ligada, tocar marca em vez de abrir a ficha
 * (a barra de ações em massa aparece embaixo e a contagem é anunciada para o leitor de tela). Quem já é "Não é cliente" não é marcável.
 */
export function ContactsList({ rows, term, tagOptions, canExport, mass }: { rows: ContactRow[]; term: string; tagOptions: string[]; canExport: boolean; mass?: { tags: string[] } | null }) {
  const sel = useQueueSelection();
  // Relógio da tela (de minuto em minuto) para o "Próximo horário": nada de Date.now() no render.
  const nowMs = useClock((now) => Math.floor(now / 60_000) * 60_000);
  const selecting = !!sel?.mode;
  const order = rows.filter((r) => !r.ignored).map((r) => r.id);
  const ids = order.filter((id) => sel?.selected.has(id));
  const pick = (c: ContactRow) => (e: MouseEvent) => sel?.toggle(c.id, { range: e.shiftKey, order });

  /** Linha clicável: ficha (link) ou, na seleção, a caixinha (botão `checkbox` que cobre a linha). */
  const target = (c: ContactRow, label: ReactNode, cls: string): ReactNode => {
    if (!selecting) return <Link href={`/contatos/${c.id}`} className={cls}>{label}</Link>;
    const checked = !!sel?.selected.has(c.id);
    return (
      <button type="button" role="checkbox" aria-checked={checked} disabled={c.ignored} onClick={pick(c)} className={cn(cls, "text-left disabled:cursor-not-allowed disabled:opacity-50")}>
        <Box checked={checked} />{label}
      </button>
    );
  };

  return (
    <>
      <span role="status" aria-live="polite" data-testid="anuncio-selecao" className="sr-only">{selecting ? `${ids.length} ${ids.length === 1 ? "selecionado" : "selecionados"}` : ""}</span>

      <ul className="divide-y divide-line/70 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper sm:hidden" aria-label="Clientes">
        {rows.map((c) => {
          const name = c.name?.trim() ? titleName(c.name.trim()) : formatPhoneClient(c.phone);
          const checked = !!sel?.selected.has(c.id);
          return (
            <li key={c.id} className={cn(checked && "bg-gold-soft/50", c.ignored && selecting && "opacity-60")}>
              {target(c, (
                <>
                  <ContactAvatar contactId={c.id} hasAvatar={c.hasAvatar} name={name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 break-words text-md font-medium"><Highlight text={name} term={term} /></span>
                      <span className="shrink-0"><StatusBadge c={c} compact /></span>
                    </span>
                    <span className="block truncate text-sm tabular text-graphite">{formatPhoneClient(c.phone)}{c.situation ? ` · ${c.situation}` : ""}</span>
                    <Snippet c={c} term={term} />
                  </span>
                </>
              ), "flex min-h-[4.25rem] items-start gap-3 px-4 py-3 active:bg-paper-2")}
            </li>
          );
        })}
      </ul>

      <div className="hidden overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper sm:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-5 py-3 font-medium">Nome</th><th className="px-3 font-medium">Situação</th>
              <th className="hidden px-3 font-medium md:table-cell">Última visita</th>
              <th className="hidden px-3 pr-5 font-medium lg:table-cell">Próximo horário</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const name = c.name?.trim() ? titleName(c.name.trim()) : formatPhoneClient(c.phone);
              const checked = !!sel?.selected.has(c.id);
              return (
                <tr key={c.id} className={cn("relative border-b border-line/70 transition-colors last:border-0 hover:bg-paper-2/60", checked && "bg-gold-soft/50", c.ignored && selecting && "opacity-60")}>
                  <td className="max-w-[26rem] px-5 py-2.5">
                    {target(c, (
                      <>
                      <ContactAvatar contactId={c.id} hasAvatar={c.hasAvatar} name={name} size={36} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium"><Highlight text={name} term={term} /></span>
                        <span className="block text-xs tabular text-graphite">{formatPhoneClient(c.phone)}</span>
                        <Snippet c={c} term={term} lines={1} />
                      </span>
                      </>
                    ), "flex items-center gap-3 after:absolute after:inset-0 hover:text-gold-ink")}
                  </td>
                  <td className="px-3"><span className="block max-w-[18rem] truncate text-graphite first-letter:uppercase" title={c.situation}>{c.situation || "—"}</span><StatusBadge c={c} compact /></td>
                  <td className="hidden whitespace-nowrap px-3 tabular text-graphite md:table-cell">{c.lastVisitOn ? c.lastVisitOn.split("-").reverse().join("/") : "—"}</td>
                  <td className="hidden whitespace-nowrap px-3 pr-5 text-graphite lg:table-cell" suppressHydrationWarning>{c.nextAppointmentAt ? dueLabel(Date.parse(c.nextAppointmentAt), nowMs) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ContactsBulkBar ids={ids} tagOptions={tagOptions} canExport={canExport} mass={mass} />
    </>
  );
}
