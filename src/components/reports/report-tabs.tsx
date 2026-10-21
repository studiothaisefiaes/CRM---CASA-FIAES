"use client";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { UnderlineTabs } from "@/components/ui/tabs";
import { relatoriosTabs } from "@/lib/section-tabs";

/** Visões que moram na própria tela /relatorios (?aba=…). As outras (Comissão, Jornada, Relatórios do Avec) são rotas com a aba acesa. */
export type ReportTab = "visao" | "salao" | "analise" | "financeiro";
export type ReportsTabValue = ReportTab | "comissao" | "jornada" | "avec";
/** Abas com período por datas (salonRange): guardam `de`/`ate` e os atalhos "mês passado" e "livre". */
const DATED: string[] = ["salao", "financeiro"];
const OTHER_PERIODS = ["hoje", "7d", "mes", "ano"];

/**
 * A barra de visões de Relatórios: Visão geral · Salão · Análise · Financeiro (cada uma só para quem pode), com o estado na URL (?aba=…).
 * O que leva a outra página (Comissão, Jornada, Relatórios do Avec) não finge ser aba: vira link "Abrir" em {@link MoreReports}.
 */
export function ReportTabs({ value, perms }: { value: ReportsTabValue; perms: readonly string[] }) {
  const sp = useSearchParams(); const router = useRouter();
  const here = ["visao", "salao", "analise", "financeiro"].includes(value);
  // Só as visões desta tela são abas. Comissão, Jornada e Relatórios do Avec são outras páginas: abrem pelo "Mais relatórios" e, lá dentro, voltam por um link.
  const tabs = relatoriosTabs(perms).filter((t) => ["visao", "salao", "analise", "financeiro"].includes(t.key));
  if (!here) return <Link href="/relatorios" className="inline-flex min-h-11 items-center text-sm font-medium text-gold-ink hover:underline">← Relatórios</Link>;
  return (
    <UnderlineTabs<string> label="Seção do relatório" idPrefix="rel" value={value} items={tabs.map((t) => ({ value: t.key, label: t.label }))} className="w-full max-w-4xl"
      onChange={(v) => {
        const tab = tabs.find((t) => t.key === v);
        if (!tab) return;
        const p = new URLSearchParams(sp.toString());
        p.set("aba", v);
        p.delete("vista"); // a vista (Entradas, Contas a pagar…) é só do Financeiro
        // As outras abas não têm "mês passado" nem datas livres.
        if (!DATED.includes(v)) { p.delete("de"); p.delete("ate"); if (!OTHER_PERIODS.includes(p.get("periodo") ?? "mes")) p.delete("periodo"); }
        router.replace(`/relatorios?${p}`, { scroll: false });
      }} />
  );
}
