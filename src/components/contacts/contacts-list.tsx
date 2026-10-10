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
import { cn } from "@/lib/cn";

const shortDate = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Bahia" });
const firstName = (n: string | null) => n?.trim().split(/\s+/)[0] ?? "";

function StatusBadge({ c }: { c: ContactRow }) {
  if (c.ignored) return <Badge className="border border-line-strong">Não é cliente</Badge>;
  if (c.isClient) return <Badge tone="ok">Cliente{c.clientSince ? ` desde ${new Date(c.clientSince).getFullYear()}` : ""}</Badge>;
  return c.openDealId ? <Badge tone="gold">Lead</Badge> : <Badge>Contato</Badge>;
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
export function ContactsList({ rows, term }: { rows: ContactRow[]; term: string }) {
  const sel = useQueueSelection();
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

      <ul className="divide-y divide-line/70 overflow-hidden rounded-[var(--radius-panel)] border border-line bg-paper sm:hidden" aria-label="Contatos">
        {rows.map((c) => {
          const name = c.name?.trim() || formatPhoneClient(c.phone);
          const checked = !!sel?.selected.has(c.id);
          return (
            <li key={c.id} className={cn(checked && "bg-gold-soft/50", c.ignored && selecting && "opacity-60")}>
              {target(c, (
                <>
                  <ContactAvatar contactId={c.id} hasAvatar={c.hasAvatar} name={name} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate text-md font-medium"><Highlight text={name} term={term} /></span>
                      <span className="shrink-0"><StatusBadge c={c} /></span>
                    </span>
                    <span className="block truncate text-sm tabular text-graphite">{formatPhoneClient(c.phone)}{c.openDealId ? ` · ${c.openDealOwnerName ? `com ${firstName(c.openDealOwnerName)}` : "sem dono"}` : ""}</span>
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
              <th className="px-5 py-3 font-medium">Nome</th><th className="px-3 font-medium">Telefone</th><th className="px-3 font-medium">Situação</th>
              <th className="hidden px-3 font-medium lg:table-cell">Com</th><th className="hidden px-3 font-medium md:table-cell">Último atendimento</th><th className="px-3 pr-5 text-right font-medium">Leads</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const name = c.name?.trim() || formatPhoneClient(c.phone);
              const checked = !!sel?.selected.has(c.id);
              return (
                <tr key={c.id} className={cn("relative border-b border-line/70 transition-colors last:border-0 hover:bg-paper-2/60", checked && "bg-gold-soft/50", c.ignored && selecting && "opacity-60")}>
                  <td className="max-w-[26rem] px-5 py-2.5">
                    {target(c, (
                      <span className="min-w-0">
                        <span className="block truncate font-medium"><Highlight text={name} term={term} /></span>
                        <Snippet c={c} term={term} lines={1} />
                      </span>
                    ), "flex items-start gap-3 after:absolute after:inset-0 hover:text-gold-ink")}
                  </td>
                  <td className="whitespace-nowrap px-3 tabular text-graphite">{formatPhoneClient(c.phone)}</td>
                  <td className="px-3"><StatusBadge c={c} /></td>
                  <td className="hidden px-3 text-graphite lg:table-cell">{c.openDealId ? (c.openDealOwnerName ? firstName(c.openDealOwnerName) : "Sem dono") : "—"}</td>
                  <td className="hidden px-3 text-graphite md:table-cell">{c.lastServiceAt ? new Date(c.lastServiceAt).toLocaleDateString("pt-BR", { timeZone: "America/Bahia" }) : "—"}</td>
                  <td className="px-3 pr-5 text-right tabular">{c.deals}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ContactsBulkBar ids={ids} />
    </>
  );
}
