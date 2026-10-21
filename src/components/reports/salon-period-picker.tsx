"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { SALON_PRESETS, SALON_PRESET_LABEL, salonQuery, type SalonPreset } from "@/lib/salon-period";
import { cn } from "@/lib/cn";

/** Período do Salão (e do Financeiro, `aba`): atalhos e "Escolher datas" (de/até). Troca a URL; o servidor refaz o painel e corrige data torta. */
export function SalonPeriodPicker({ preset, from, to, aba = "salao", vista, path = "/relatorios", keep }: { preset: SalonPreset; from: string; to: string; aba?: "salao" | "financeiro"; vista?: string; /** Outra página com o mesmo período (Exceções): sem `aba` na URL. */ path?: string; /** Parâmetros que a troca de período mantém (o filtro de tipo). */ keep?: Record<string, string> }) {
  const router = useRouter();
  const [livre, setLivre] = useState(preset === "livre");
  const [de, setDe] = useState(from), [ate, setAte] = useState(to);
  const go = (q: string) => {
    if (path === "/relatorios") { router.replace(`${path}?${q}`, { scroll: false }); return; }
    const sp = new URLSearchParams(q); sp.delete("aba");
    for (const [k, v] of Object.entries(keep ?? {})) sp.set(k, v);
    router.replace(`${path}?${sp}`, { scroll: false });
  };
  const on = (p: SalonPreset) => (p === "livre" ? livre : !livre && p === preset);
  const input = "h-11 lg:h-9 rounded-[var(--radius-control)] border border-control bg-paper px-3 text-md lg:text-sm";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={aba === "salao" ? "Período do Salão" : "Período do Financeiro"}>
        {SALON_PRESETS.map((p) => (
          <button key={p} type="button" aria-pressed={on(p)}
            onClick={() => { if (p === "livre") setLivre(true); else { setLivre(false); go(salonQuery({ preset: p, from, to }, aba, vista)); } }}
            className={cn("min-h-11 lg:min-h-8 rounded-full border px-3 text-sm font-medium transition-colors",
              on(p) ? "border-ink bg-ink text-paper" : "border-line-strong text-graphite hover:bg-paper-2")}>
            {SALON_PRESET_LABEL[p]}
          </button>
        ))}
      </div>
      {livre && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); go(salonQuery({ preset: "livre", from: de, to: ate }, aba, vista)); }}>
          <label className="flex flex-col gap-1 text-sm text-graphite">De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={input} /></label>
          <label className="flex flex-col gap-1 text-sm text-graphite">Até<input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={input} /></label>
          <button type="submit" className="min-h-11 lg:min-h-9 rounded-[var(--radius-control)] bg-ink px-4 text-sm font-medium text-paper">Ver</button>
        </form>
      )}
    </div>
  );
}
