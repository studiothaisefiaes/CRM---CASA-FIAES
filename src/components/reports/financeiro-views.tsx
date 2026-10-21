"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

export type FinanceVista = "entradas" | "contas" | "resultado" | "notas";
const ALL: { value: FinanceVista; label: string }[] = [
  { value: "entradas", label: "Entradas" }, { value: "contas", label: "Contas a pagar" }, { value: "resultado", label: "Resultado" }, { value: "notas", label: "Notas fiscais" },
];

/**
 * Abas do Financeiro (?vista=…). Entradas sempre; Contas a pagar só com a função ligada em Configurações › Financeiro; Notas fiscais só com `notas`.
 * Resultado só com a função ligada em Configurações › Financeiro.
 */
export function FinanceViews({ value, notas, contas, resultado }: { value: FinanceVista; notas: boolean; contas: boolean; resultado: boolean }) {
  const sp = useSearchParams(); const router = useRouter();
  const items = ALL.filter((t) => t.value === "entradas" || (t.value === "contas" && contas) || (t.value === "resultado" && resultado) || (t.value === "notas" && notas));
  return (
    <Tabs<FinanceVista> label="Vista do Financeiro" value={value} items={items} className="max-w-xl"
      onChange={(v) => {
        const p = new URLSearchParams(sp.toString());
        p.set("aba", "financeiro");
        if (v === "entradas") p.delete("vista"); else p.set("vista", v);
        router.replace(`/relatorios?${p}`, { scroll: false });
      }} />
  );
}
