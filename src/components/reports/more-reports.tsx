import Link from "next/link";
import { caixaLeituraLinks, relatoriosTabs } from "@/lib/section-tabs";

const MAIS: Record<string, string> = {
  jornada: "Por onde a cliente passa, da primeira conversa à volta.",
  avec: "Os relatórios que vêm do Avec.",
  caixas: "Cada caixa aberto e os fechados hoje: quem abriu, o que entrou e a diferença.",
  fechamentos: "Os últimos caixas de cada pessoa: quem abriu, quem fechou e a diferença.",
};

/**
 * "Mais relatórios" (r66 #9): o que leva a outra página aparece aqui, como link "Abrir", e não como aba da mesma tela. No Financeiro, só os
 * do dinheiro (Caixas da equipe e Fechamentos, para quem vê os caixas de todas: o Contador abre por aqui, 26/10).
 */
export function MoreReports({ perms, aba = "visao" }: { perms: readonly string[]; aba?: "visao" | "financeiro" }) {
  const caixa = caixaLeituraLinks(perms);
  const items = aba === "financeiro" ? caixa : [...relatoriosTabs(perms).filter((t) => t.key in MAIS), ...caixa];
  if (!items.length) return null;
  return (
    <section aria-label="Mais relatórios" className="mt-10">
      <h2 className="text-lg font-semibold">Mais relatórios</h2>
      <ul className="mt-3 divide-y divide-line/70 rounded-[var(--radius-card)] border border-line bg-paper">
        {items.map((t) => (
          <li key={t.key} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0"><span className="block font-medium">{t.label}</span><span className="block text-sm text-graphite">{MAIS[t.key]}</span></span>
            <Link href={t.href} aria-label={`Abrir ${t.label}`} className="inline-flex min-h-11 shrink-0 items-center rounded-[var(--radius-control)] border border-line-strong px-4 text-sm font-medium hover:bg-paper-2">Abrir</Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
