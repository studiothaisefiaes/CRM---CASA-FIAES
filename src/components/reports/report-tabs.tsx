"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";

export type ReportTab = "visao" | "analise";
const ITEMS = [{ value: "visao", label: "Visão geral" }, { value: "analise", label: "Análise" }] as const satisfies readonly { value: ReportTab; label: string }[];

/** Abas Visão geral / Análise. O estado mora na URL (?aba=analise), então dá para compartilhar e o voltar do navegador funciona. */
export function ReportTabs({ value }: { value: ReportTab }) {
  const sp = useSearchParams(); const router = useRouter();
  return (
    <Tabs<ReportTab> label="Seção do relatório" value={value} items={[...ITEMS]} className="max-w-sm"
      onChange={(v) => { const p = new URLSearchParams(sp.toString()); p.set("aba", v); router.replace(`/relatorios?${p}`, { scroll: false }); }} />
  );
}
