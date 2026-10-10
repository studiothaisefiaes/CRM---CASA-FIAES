"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { motion } from "motion/react";
import { SPRING } from "@/lib/motion";

const P = [["hoje", "Hoje"], ["7d", "7 dias"], ["mes", "Mês"], ["ano", "Ano"]] as const;

export function PeriodTabs({ people, origins }: { people: { id: string; name: string }[]; origins: string[] }) {
  const sp = useSearchParams(); const router = useRouter();
  const current = ({ semana: "7d" } as Record<string, string>)[sp.get("periodo") ?? ""] ?? sp.get("periodo") ?? "mes";
  const set = (k: string, v: string) => { const p = new URLSearchParams(sp.toString()); if (v) p.set(k, v); else p.delete(k); router.replace(`/relatorios?${p}`, { scroll: false }); };
  const sel = "h-9 pointer-coarse:h-11 text-[16px] sm:text-sm rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 pr-7 text-sm appearance-none cursor-pointer";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex bg-paper-2 border border-line rounded-full p-1" role="tablist" aria-label="Período">
        {P.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={current === k} onClick={() => set("periodo", k)} className={`relative h-7 pointer-coarse:h-9 px-3.5 text-sm font-medium rounded-full transition-colors ${current === k ? "text-paper" : "text-graphite hover:text-ink"}`}>
            {current === k && <motion.span layoutId="period-pill" transition={SPRING} className="absolute inset-0 rounded-full bg-ink" />}
            <span className="relative">{label}</span>
          </button>
        ))}
      </div>
      {people.length > 0 && <select aria-label="Pessoa" value={sp.get("dono") ?? ""} onChange={(e) => set("dono", e.target.value)} className={sel}><option value="">Toda a equipe</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
      <select aria-label="Origem" value={sp.get("origem") ?? ""} onChange={(e) => set("origem", e.target.value)} className={sel}><option value="">Todas as origens</option>{origins.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    </div>
  );
}
