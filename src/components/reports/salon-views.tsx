"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

export type SalonVista = "resumo" | "ocupacao";

/** Abas do Salão (?vista=…): Resumo (o Salão de sempre) e Ocupação. Só aparecem quando a Ocupação está ligada em Configurações › Relatórios. */
export function SalonViews({ value }: { value: SalonVista }) {
  const sp = useSearchParams(); const router = useRouter();
  return (
    <Tabs<SalonVista> label="Vista do Salão" value={value} className="max-w-xs"
      items={[{ value: "resumo", label: "Resumo" }, { value: "ocupacao", label: "Ocupação" }]}
      onChange={(v) => {
        const p = new URLSearchParams(sp.toString());
        p.set("aba", "salao");
        p.delete("prof"); p.delete("medida");
        if (v === "resumo") p.delete("vista"); else p.set("vista", v);
        router.replace(`/relatorios?${p}`, { scroll: false });
      }} />
  );
}
