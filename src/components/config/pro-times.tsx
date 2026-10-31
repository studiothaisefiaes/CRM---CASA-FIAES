"use client";
import { useState, useTransition } from "react";
import { setProServiceTermsAction } from "@/app/(app)/servicos/actions";
import { useToast } from "@/components/ui/toast";
import type { ProServiceTime } from "@/server/domain/professionals";
import { displayName } from "@/lib/display-name";
import { cn } from "@/lib/cn";

/**
 * Tempos (Cati 30/10): uma profissional por vez, o tempo de cada serviço que ela faz. Grava ao sair do campo. Vazio usa o tempo do serviço; sem
 * nenhum dos dois, a Agenda reserva 1 h e o "Confirmar e marcar" da IA abre a folha para conferir. Quem faz o quê fica na aba ao lado.
 */
export function ProTimes({ rows }: { rows: ProServiceTime[] }) {
  const toast = useToast();
  const [, start] = useTransition();
  const [saved, setSaved] = useState<Record<string, number | null>>({});
  const pros = [...new Map(rows.map((r) => [r.professionalId, r.professionalName])).entries()];
  const [proId, setProId] = useState(pros[0]?.[0] ?? "");
  const key = (r: ProServiceTime) => `${r.professionalId}|${r.serviceId}`;
  const own = (r: ProServiceTime) => (key(r) in saved ? saved[key(r)] : r.own);
  const falta = (r: ProServiceTime) => own(r) == null && r.base == null;
  const faltam = (id: string) => rows.filter((r) => r.professionalId === id && falta(r)).length;
  const save = (r: ProServiceTime, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v === own(r)) return;
    start(async () => {
      const x = await setProServiceTermsAction(r.professionalId, r.serviceId, { durationMin: v });
      if (!x.ok) { toast(x.error ?? "Não deu para salvar. Tente de novo.", "error"); return; }
      setSaved((s) => ({ ...s, [key(r)]: v }));
    });
  };
  if (!pros.length) return <p className="text-sm text-muted">Nenhuma profissional com serviço. Marque em Quem faz o quê.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-graphite">O tempo que cada profissional leva em cada serviço, em minutos (2 h = 120). A Agenda e a IA usam este tempo para saber até quando ela fica ocupada.</p>
      <div role="group" aria-label="Profissional" className="flex flex-wrap gap-2">
        {pros.map(([id, name]) => (
          <button key={id} type="button" aria-pressed={id === proId} onClick={() => setProId(id)}
            className={cn("inline-flex min-h-11 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-sm font-medium lg:min-h-9", id === proId ? "border-ink bg-ink text-paper" : "border-line-strong bg-paper text-graphite hover:text-ink")}>
            {displayName(name)}
            {faltam(id) > 0 && <span className={cn("rounded-full px-1.5 text-xs tabular", id === proId ? "bg-paper/20" : "bg-gold-soft text-gold-ink")} aria-label={`faltam ${faltam(id)}`}>{faltam(id)}</span>}
          </button>
        ))}
      </div>
      <ul className="max-w-2xl divide-y divide-line rounded-[var(--radius-control)] border border-line bg-paper">
        {rows.filter((r) => r.professionalId === proId).map((r) => (
          <li key={key(r)} className="flex items-center gap-3 px-3 py-2">
            <label htmlFor={`t-${key(r)}`} className="min-w-0 flex-1 text-sm text-ink">{displayName(r.serviceLabel)}{r.category && <span className="block text-xs text-muted">{r.category}</span>}</label>
            {falta(r) && <span className="text-xs font-medium text-gold-ink">falta</span>}
            <input id={`t-${key(r)}`} key={own(r) ?? "v"} type="number" inputMode="numeric" min={5} max={720} step={5} defaultValue={own(r) ?? ""} placeholder={r.base != null ? String(r.base) : "min"}
              onBlur={(e) => save(r, e.target.value)} className="h-11 w-20 rounded-[var(--radius-control)] border border-line-strong bg-paper px-2 text-right text-sm tabular focus:border-ink focus:outline-none lg:h-9" />
            <span className="text-xs text-muted">min</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
