"use client";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/field";
import { peopleOnNumberAction, searchClientsAction } from "@/app/(app)/agenda/actions";
import type { AgendaClientHit } from "@/server/queries/agenda-clients";
import { formatPhoneClient } from "@/lib/phone-client";

export type PickedClient = { kind: "contato"; contactId: string; name: string } | { kind: "nova"; name: string; phone: string };
const DM = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

type NumberPerson = { id: string; name: string | null; relation: string | null; isHolder: boolean };

/**
 * Cliente do horário: busca por nome ou telefone (com a última visita) ou "Cliente nova" (nome e celular). Telefone que já existe reaproveita a ficha.
 * Várias pessoas no mesmo número (0051, mãe e filha no mesmo celular): com a cliente escolhida, "Para quem é o horário?" troca entre as
 * pessoas do número, mesmo vindo da conversa (`locked`); `peopleChoice={false}` (Remarcar) não deixa trocar.
 */
export function ClientPicker({ value, onChange, locked = false, peopleChoice = true }: { value: PickedClient | null; onChange: (c: PickedClient | null) => void; locked?: boolean; peopleChoice?: boolean }) {
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<NumberPerson[]>([]);
  const pickedId = value?.kind === "contato" ? value.contactId : null;
  const known = !!pickedId && people.some((p) => p.id === pickedId);
  useEffect(() => {
    if (!peopleChoice || !pickedId || known) return;
    let alive = true;
    peopleOnNumberAction(pickedId).then((r) => { if (alive) setPeople(r.ok ? r.data ?? [] : []); });
    return () => { alive = false; };
  }, [peopleChoice, pickedId, known]);
  const [found, setHits] = useState<AgendaClientHit[]>([]);
  const searching = q.trim().length >= 2;
  const hits = searching ? found : [];
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const t = setTimeout(async () => { const r = await searchClientsAction(q); if (alive) setHits(r.ok ? r.data ?? [] : []); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, searching]);

  if (value?.kind === "contato") {
    const choices = peopleChoice && known && people.length > 1 ? people : [];
    return (
      <div className="flex flex-col gap-2">
        <div className="flex min-h-11 items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2">
          <span className="font-medium" data-testid="cliente-escolhida">{value.name}</span>
          {!locked && <button type="button" className="text-sm text-gold-ink hover:underline" onClick={() => onChange(null)}>Trocar</button>}
        </div>
        {choices.length > 0 && (
          <div role="radiogroup" aria-label="Para quem é o horário?" className="flex flex-col gap-1.5">
            <span className="text-sm text-graphite">Para quem é o horário? Este número tem {choices.length} pessoas.</span>
            <div className="flex flex-wrap gap-1.5">
              {choices.map((p) => {
                const on = p.id === value.contactId;
                const label = p.name?.trim() || "Sem nome";
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onChange({ kind: "contato", contactId: p.id, name: label })}
                    className={`inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm lg:min-h-9 ${on ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-ink hover:bg-paper-2"}`}>
                    {label}{p.relation ? <span className={on ? "text-paper/80" : "text-muted"}>· {p.relation}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }
  if (value?.kind === "nova") return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Input aria-label="Nome da cliente nova" value={value.name} maxLength={120} onChange={(e) => onChange({ ...value, name: e.target.value })} className="h-11" />
      <Input aria-label="Celular da cliente nova" inputMode="tel" placeholder="71 99999-9999" value={value.phone} onChange={(e) => onChange({ ...value, phone: e.target.value })} className="h-11" />
      <button type="button" className="justify-self-start text-sm text-gold-ink hover:underline" onClick={() => onChange(null)}>Buscar uma cliente que já existe</button>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <Input type="search" aria-label="Buscar cliente por nome ou telefone" placeholder="Nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} className="h-11" />
      {hits.length > 0 && (
        <ul aria-label="Clientes encontradas" className="flex flex-col overflow-hidden rounded-[var(--radius-control)] border border-line">
          {hits.map((h) => (
            <li key={h.id} className="border-t border-line/70 first:border-t-0">
              <button type="button" onClick={() => onChange({ kind: "contato", contactId: h.id, name: h.name })} className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-paper-2 pointer-coarse:min-h-11">
                <span className="font-medium">{h.name}</span>
                <span className="text-xs text-muted">
                  {[h.sharesWith ? `usa o número de ${h.sharesWith.name?.trim() || "outra cliente"}${h.sharesWith.relation ? ` (${h.sharesWith.relation})` : ""}` : null,
                    h.phone ? formatPhoneClient(h.phone) : null, h.lastVisit ? `última visita ${DM.format(new Date(`${h.lastVisit}T12:00:00Z`))}` : "sem visitas", h.ignored ? "estava como Não é cliente" : null].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="self-start text-sm font-medium text-gold-ink hover:underline"
        onClick={() => onChange({ kind: "nova", name: q.replace(/[\d()+\-.]/g, "").trim(), phone: q.replace(/\D/g, "") })}>Cliente nova</button>
    </div>
  );
}
