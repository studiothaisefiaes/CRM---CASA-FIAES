"use client";
import Link from "next/link";
import { useTransition } from "react";
import { birthdayConversationAction } from "@/app/(app)/contatos/actions";
import { ContactAvatar } from "@/components/ui/contact-avatar";
import { useToast } from "@/components/ui/toast";
import { contactHref } from "@/lib/lead-href";
import { displayName } from "@/lib/display-name";
import type { TodayBirthday } from "@/server/queries/today";

const BTN = "inline-flex min-h-11 shrink-0 items-center rounded-full border border-gold/60 bg-gold-soft px-3.5 text-sm font-medium text-gold-ink hover:brightness-[0.97] disabled:opacity-60 lg:min-h-9";

/** Sem lead aberto: abre a conversa (como "Iniciar conversa", nada é enviado) e o campo já vem com o parabéns. */
function StartBirthday({ contactId, name }: { contactId: string; name: string }) {
  const [pending, start] = useTransition();
  const toast = useToast();
  return (
    <button type="button" disabled={pending} aria-label={`Mandar parabéns para ${name}`} className={BTN}
      onClick={() => start(async () => { const r = await birthdayConversationAction(contactId); if (r && !r.ok) toast(r.error, "error"); })}>
      Mandar parabéns
    </button>
  );
}

function Parabens({ b }: { b: TodayBirthday }) {
  return b.dealId
    ? <Link href={`/atendimento/${b.dealId}?compose=1&parabens=1`} aria-label={`Mandar parabéns para ${b.name}`} className={BTN}>Mandar parabéns</Link>
    : <StartBirthday contactId={b.contactId} name={b.name} />;
}

function Row({ b }: { b: TodayBirthday }) {
  return (
    <li className="flex items-center gap-3 py-2">
      <Link href={contactHref(b.contactId)} aria-label={`Ficha de ${b.name}`} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 hover:text-gold-ink">
        <ContactAvatar contactId={b.contactId} hasAvatar={b.hasAvatar} name={b.name} size={40} />
        <span className="min-w-0 break-words text-sm font-medium">{b.name}</span>
      </Link>
      <Parabens b={b} />
    </li>
  );
}

/**
 * O painel de "Aniversário hoje" (bloco do Hoje desde 16/10; prévia no resumo do Hoje v3): quem faz hoje, com foto e "Mandar parabéns",
 * e os próximos 7 dias. "Mandar parabéns" só PREENCHE a mensagem na conversa: quem envia é a atendente.
 */
export function BirthdaysPanel({ items }: { items: TodayBirthday[] }) {
  const named = items.map((x) => ({ ...x, name: displayName(x.name) }));
  const today = named.filter((b) => b.today);
  const next = named.filter((b) => !b.today);
  return (
    <>
      {today.length > 0 ? <ul className="divide-y divide-line/70">{today.map((b) => <Row key={b.contactId} b={b} />)}</ul> : <p className="text-sm text-muted">Nenhum aniversário hoje.</p>}
      <h3 className="mt-5 text-sm font-semibold text-graphite">Próximos 7 dias</h3>
      {next.length === 0 ? <p className="mt-1 text-sm text-muted">Nenhum aniversário nos próximos 7 dias.</p> : (
        <ul className="mt-1 divide-y divide-line/70">
          {next.map((b) => (
            <li key={b.contactId}>
              <Link href={contactHref(b.contactId)} aria-label={`Ficha de ${b.name}, aniversário ${b.label}`} className="flex min-h-11 items-center justify-between gap-3 text-sm hover:text-gold-ink">
                <span className="flex min-w-0 items-center gap-3"><ContactAvatar contactId={b.contactId} hasAvatar={b.hasAvatar} name={b.name} size={32} /><span className="truncate">{b.name}</span></span>
                <span className="shrink-0 text-muted tabular">{b.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
