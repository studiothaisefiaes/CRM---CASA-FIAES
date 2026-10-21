"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/field";
import { clientAgendaAction, searchClientsAction } from "@/app/(app)/agenda/actions";
import type { AgendaClientHit, ClientAgenda } from "@/server/queries/agenda-clients";

const WHEN = new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Bahia" });
const GROUPS: [keyof ClientAgenda, string][] = [["futuros", "Próximos"], ["passados", "Anteriores"], ["cancelados", "Cancelados"]];

/** "Buscar cliente na Agenda" (6.1): os horários dela (próximos, anteriores e cancelados); um toque leva ao dia com o horário destacado. */
export function AgendaSearch({ autoFocus = false, onQuery }: { autoFocus?: boolean; /** Nova Agenda: o texto também apaga, na grade, os cartões que não batem. */ onQuery?: (q: string) => void } = {}) {
  const [q, setQ] = useState("");
  const [found, setHits] = useState<AgendaClientHit[]>([]);
  const [picked, setPicked] = useState<{ name: string; agenda: ClientAgenda } | null>(null);
  const searching = !picked && q.trim().length >= 2;
  const hits = searching ? found : [];
  useEffect(() => {
    if (!searching) return;
    let alive = true;
    const t = setTimeout(async () => { const r = await searchClientsAction(q); if (alive) setHits(r.ok ? r.data ?? [] : []); }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, searching]);
  const pick = async (h: AgendaClientHit) => {
    const r = await clientAgendaAction(h.id);
    if (r.ok && r.data) { setPicked({ name: h.name, agenda: r.data }); setHits([]); }
  };
  return (
    <div className="relative w-full sm:w-72">
      <Input type="search" aria-label="Buscar cliente na Agenda" placeholder="Buscar cliente" value={q} className="h-11 sm:h-10" autoFocus={autoFocus}
        onChange={(e) => { setQ(e.target.value); setPicked(null); onQuery?.(e.target.value); }} />
      {hits.length > 0 && (
        <ul aria-label="Clientes encontradas" className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-[var(--radius-control)] border border-line bg-paper shadow-[var(--shadow-card)]">
          {hits.map((h) => (
            <li key={h.id}><button type="button" onClick={() => pick(h)} className="w-full px-3 py-2 text-left text-sm hover:bg-paper-2 pointer-coarse:min-h-11">{h.name}</button></li>
          ))}
        </ul>
      )}
      {picked && (
        <section aria-label={`Horários de ${picked.name}`} className="absolute inset-x-0 top-full z-40 mt-1 flex max-h-[60vh] flex-col gap-3 overflow-auto rounded-[var(--radius-control)] border border-line bg-paper p-3 shadow-[var(--shadow-card)]">
          {GROUPS.map(([k, label]) => picked.agenda[k].length > 0 && (
            <div key={k}>
              <h3 className="mb-1 text-xs font-semibold text-muted">{label}</h3>
              <ul className="flex flex-col gap-1">
                {picked.agenda[k].map((e) => (
                  <li key={e.appointmentId}>
                    <Link href={`/agenda?d=${e.day}&destaque=${e.appointmentId}`} className="block rounded-[6px] px-2 py-1.5 text-sm hover:bg-paper-2">
                      {WHEN.format(new Date(e.startsAt)).replace(".", "")} · {e.serviceLabel}{e.professionalName ? ` com ${e.professionalName}` : ""}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {GROUPS.every(([k]) => !picked.agenda[k].length) && <p className="text-sm text-muted">Nenhum horário na agenda.</p>}
          <button type="button" className="self-end text-sm text-gold-ink hover:underline" onClick={() => { setPicked(null); setQ(""); }}>Fechar</button>
        </section>
      )}
    </div>
  );
}
