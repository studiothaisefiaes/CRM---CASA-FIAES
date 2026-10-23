"use client";
import { useId, useState } from "react";
import { Input } from "@/components/ui/field";
import { money } from "@/lib/format";
import { cn } from "@/lib/cn";

export type CatalogService = { id: string; label: string; priceCents?: number | null };
const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const byName = (a: CatalogService, b: CatalogService) => a.label.localeCompare(b.label, "pt-BR");

/**
 * A ordem da busca de serviço (22/10, "pesquisar melhor"): sem acento e sem maiúscula; primeiro os que a profissional faz
 * (`professional_services`), e dentro de cada grupo a palavra que começa com o termo antes de "contém"; empate pelo nome.
 */
export function rankServices<S extends CatalogService>(services: S[], query: string, professionalId: string | null, proServices: Record<string, string[]>): S[] {
  const t = fold(query);
  const mine = new Set(professionalId ? proServices[professionalId] ?? [] : []);
  const score = (s: S) => {
    const f = fold(s.label);
    const starts = !t || f.split(/\s+/).some((w) => w.startsWith(t));
    if (!starts && !f.includes(t)) return -1;
    return (mine.has(s.id) ? 0 : 2) + (starts ? 0 : 1);
  };
  return services.map((s) => ({ s, k: score(s) })).filter((x) => x.k >= 0).sort((a, b) => a.k - b.k || byName(a.s, b.s)).map((x) => x.s);
}

/** Escolher o serviço na comanda: digita e filtra (↑↓ Enter), com o preço; os da profissional escolhida no topo. */
export function ServicePicker({ services, proServices, professionalId, value, onPick }: {
  services: CatalogService[]; proServices: Record<string, string[]>; professionalId: string | null; value: string | null; onPick: (id: string | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);
  const picked = value ? services.find((s) => s.id === value) : null;
  if (picked) {
    return (
      <div className="flex items-baseline justify-between gap-3 rounded-[var(--radius-control)] border border-line px-3 py-2.5">
        <span className="min-w-0 text-base font-medium text-ink">{picked.label}{picked.priceCents != null && <span className="ml-2 text-sm font-normal text-graphite tabular-nums">{money(picked.priceCents)}</span>}</span>
        <button type="button" aria-label="Trocar serviço" onClick={() => { setQ(""); onPick(null); }} className="shrink-0 text-sm font-medium text-gold-ink underline underline-offset-4">Trocar</button>
      </div>
    );
  }
  const found = rankServices(services, q, professionalId, proServices).slice(0, 8);
  const choose = (s: CatalogService) => { setQ(""); setActive(-1); onPick(s.id); };
  return (
    <div className="flex flex-col gap-1.5">
      <Input role="combobox" aria-label="Serviço" aria-expanded={found.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={active >= 0 && found[active] ? `${id}-${found[active].id}` : undefined}
        type="search" value={q} autoComplete="off" placeholder="Buscar serviço" className="h-11"
        onChange={(e) => { setQ(e.target.value); setActive(-1); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(found.length - 1, a + 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          else if (e.key === "Enter" && found[active >= 0 ? active : 0]) { e.preventDefault(); choose(found[active >= 0 ? active : 0]); }
          else if (e.key === "Escape") { setQ(""); setActive(-1); }
        }} />
      {found.length ? (
        <ul id={`${id}-list`} role="listbox" aria-label="Serviços" className="max-h-72 divide-y divide-line/70 overflow-y-auto rounded-[var(--radius-control)] border border-line">
          {found.map((s, k) => (
            <li key={s.id}>
              <button type="button" id={`${id}-${s.id}`} role="option" aria-selected={k === active} onClick={() => choose(s)}
                className={cn("flex min-h-11 w-full items-baseline justify-between gap-3 px-3 py-2 text-left hover:bg-paper-2/60", k === active && "bg-paper-2")}>
                <span className="min-w-0 text-base text-ink">{s.label}</span>
                <span className="shrink-0 text-sm text-graphite tabular-nums">{s.priceCents != null ? money(s.priceCents) : "sem preço"}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">{`Nenhum serviço com “${q.trim()}”.`}</p>}
    </div>
  );
}
