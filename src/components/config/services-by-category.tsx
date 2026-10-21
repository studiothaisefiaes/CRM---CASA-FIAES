"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { WhoSuggestion } from "@/server/domain/agenda/who-does-what";
import type { Service } from "./professional-sheet";

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const OTHERS = "Outros";

/** Serviços que ela faz, agrupados por categoria (Listas › Serviços), com busca e caixa de marcar; o aviso das sugestões do Avec (6A). */
export function ServicesByCategory({ services, value, onToggle, suggestions, onAcceptAll, pending }: {
  services: Service[]; value: string[]; onToggle: (id: string) => void; suggestions: WhoSuggestion[]; onAcceptAll: () => void; pending: boolean;
}) {
  const [q, setQ] = useState("");
  const [showSug, setShowSug] = useState(false);
  const open = suggestions.filter((s) => !value.includes(s.serviceId));
  const sugIds = new Set(open.map((s) => s.serviceId));
  const shown = services.filter((s) => !fold(q) || fold(s.label).includes(fold(q)));
  const groups = new Map<string, Service[]>();
  for (const s of shown) { const k = s.category?.trim() || OTHERS; groups.set(k, [...(groups.get(k) ?? []), s]); }
  const names = [...groups.keys()].sort((a, b) => (a === OTHERS ? 1 : b === OTHERS ? -1 : a.localeCompare(b, "pt-BR")));
  return (
    <div className="flex flex-col gap-4">
      {open.length > 0 && (
        <div className="rounded-[var(--radius-control)] border border-gold/40 bg-gold-soft/60 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-gold-ink">{`O Avec mostra que ela fez mais ${open.length} ${open.length === 1 ? "serviço" : "serviços"} este ano`}</span>
            <Button size="sm" variant="secondary" aria-expanded={showSug} onClick={() => setShowSug((v) => !v)}>Ver e marcar</Button>
          </div>
          {showSug && (
            <>
              <ul className="mt-2 flex flex-col gap-1">
                {open.map((s) => <li key={s.serviceId}><span className="font-medium">{s.serviceLabel}</span> · <span className="text-graphite">{`fez ${s.count} ${s.count === 1 ? "vez" : "vezes"}`}</span></li>)}
              </ul>
              <Button size="sm" variant="gold" className="mt-3" loading={pending} onClick={onAcceptAll}>Marcar todos</Button>
            </>
          )}
        </div>
      )}
      <input type="search" aria-label="Buscar serviço" placeholder="Buscar serviço" value={q} onChange={(e) => setQ(e.target.value)}
        className="h-11 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm lg:h-10" />
      {names.map((cat) => (
        <fieldset key={cat} role="group" aria-label={cat} className="flex flex-col gap-1">
          <legend className="mb-1 text-xs font-semibold text-muted">{cat}</legend>
          {groups.get(cat)!.map((s) => (
            <label key={s.id} className="flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] px-2 hover:bg-paper-2 lg:min-h-9">
              <input type="checkbox" aria-label={s.label} className="size-4 accent-[var(--color-ink)]" checked={value.includes(s.id)} onChange={() => onToggle(s.id)} />
              <span className="flex-1 text-sm">{s.label}</span>
              {sugIds.has(s.id) && <span className="rounded-full bg-gold-soft px-2 text-xs text-gold-ink">sugestão do Avec</span>}
            </label>
          ))}
        </fieldset>
      ))}
      {shown.length === 0 && <p className="text-sm text-muted">Nenhum serviço com esse nome.</p>}
      {value.length === 0 && <p className="text-sm text-gold-ink">Sem serviço marcado: ela não aparece ao marcar nem ao procurar horário.</p>}
    </div>
  );
}
