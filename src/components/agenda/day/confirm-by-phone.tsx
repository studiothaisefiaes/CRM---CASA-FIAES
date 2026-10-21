"use client";
import type { ConfirmByPhoneItem } from "@/server/queries/confirm-by-phone";
import { minuteOfDay } from "@/lib/agenda";
import { hm } from "@/lib/agenda-day";
import { formatPhoneClient } from "@/lib/phone-client";
import { Empty } from "@/components/ui/empty";
import { StartConversation } from "@/components/contacts/start-conversation";

/**
 * Pendências › "Confirmar por telefone" (17/10): clientes com horário amanhã e sem conversa no CRM. Sem conversa o lembrete não sai,
 * então a recepção liga (o telefone é link) ou inicia a conversa (nada é enviado sozinho).
 */
export function ConfirmByPhoneList({ items, canStart }: { items: ConfirmByPhoneItem[]; canStart: boolean }) {
  if (!items.length) {
    return <div className="rounded-[var(--radius-card)] border border-dashed border-line-strong"><Empty title="Tudo certo para amanhã">Todas as clientes de amanhã têm conversa no CRM.</Empty></div>;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="text-md font-semibold tabular">{items.length === 1 ? "1 cliente com horário amanhã sem conversa no CRM." : `${items.length} clientes com horário amanhã sem conversa no CRM.`}</p>
      <p className="-mt-3 text-sm text-graphite">Sem conversa, elas não recebem o lembrete. Ligue para confirmar ou inicie a conversa.</p>
      <ul>
        {items.map((i) => {
          const phone = formatPhoneClient(i.phone) || i.phone;
          return (
            <li key={i.contactId} className="flex flex-wrap items-center gap-3 border-b border-line/80 py-3">
              <span className="w-16 shrink-0 text-md font-semibold tabular">{hm(minuteOfDay(i.firstStart))}</span>
              <span className="flex min-w-0 flex-[1_1_220px] flex-col">
                <span className="text-md font-semibold">{i.name}</span>
                <span className="text-sm text-graphite">{i.services.map((s) => (s.pro ? `${s.service} com ${s.pro}` : s.service)).join(" · ")}</span>
              </span>
              <a href={`tel:${i.phone}`} aria-label={`Ligar para ${i.name}: ${phone}`} className="inline-flex min-h-11 items-center text-base font-medium text-gold-ink underline-offset-4 hover:underline tabular">{phone}</a>
              {canStart && <StartConversation contactId={i.contactId} hasOpenLead={false} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
