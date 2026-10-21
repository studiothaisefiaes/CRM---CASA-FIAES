"use client";
import { useEffect, useState, useTransition } from "react";
import { searchPeopleAction } from "@/app/(app)/conversa/actions";
import { startConversationAction } from "@/app/(app)/contatos/actions";
import { formatPhoneClient } from "@/lib/phone-client";
import { firstName } from "@/lib/authorship";
import { useToast } from "@/components/ui/toast";
import type { PersonFound } from "@/server/queries/people-search";

/**
 * Embaixo da lista, quando a busca tem texto: as pessoas com esse nome/telefone/CPF que NÃO estão na lista (resolvida, antiga, nunca conversou),
 * com "Abrir conversa" (não envia nada). Quem já está na lista não repete.
 * Mãe e filha no mesmo número (21/10): a filha aparece com "número de Marta (ela é filha)"; "Abrir conversa" abre a conversa do número.
 */
export function PeopleFound({ q, inList }: { q: string; inList: Set<string> }) {
  const [list, setList] = useState<PersonFound[]>([]);
  const [pending, start] = useTransition();
  const toast = useToast();
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => { void searchPeopleAction(q).then((r) => { if (alive && r.ok) setList(r.data ?? []); }); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const shown = list.filter((p) => !inList.has(p.contactId));
  if (!shown.length) return null;
  return (
    <section aria-label="Outras pessoas com essa busca" className="border-t border-line px-3 py-2">
      <h3 className="px-1 pb-1 text-xs font-semibold text-muted">Também com “{q.trim()}” (fora da lista)</h3>
      <ul className="flex flex-col">
        {shown.map((p) => (
          <li key={p.contactId} className="flex items-center gap-2 rounded-[var(--radius-control)] px-1 py-1.5 hover:bg-paper-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{p.name}</span>
              <span className="block truncate text-xs text-muted">{formatPhoneClient(p.phone)}{p.holderId ? ` · número de ${firstName(p.holderName) || "outra cliente"}${p.relation ? ` (ela é ${p.relation})` : ""}` : ""}
                {p.hasOpen ? " · conversa aberta com outra pessoa" : " · sem conversa aberta"}</span>
            </span>
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await startConversationAction(p.contactId); if (r && !r.ok) toast(r.error, "error"); })}
              className="min-h-9 shrink-0 rounded-[10px] border border-line-strong bg-paper px-3 text-sm font-medium text-ink hover:border-ink disabled:opacity-60 pointer-coarse:min-h-11">Abrir conversa</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
