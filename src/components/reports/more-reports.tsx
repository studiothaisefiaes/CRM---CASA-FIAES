import Link from "next/link";
import { relatoriosTabs } from "@/lib/section-tabs";

const MAIS: Record<string, string> = {
  jornada: "Por onde a cliente passa, da primeira conversa à volta.",
  avec: "Os relatórios que vêm do Avec.",
};

/** "Mais relatórios" (r66 #9): o que leva a outra página aparece aqui, como link "Abrir", e não como aba da mesma tela. */
export function MoreReports({ perms }: { perms: readonly string[] }) {
  const items = relatoriosTabs(perms).filter((t) => t.key in MAIS);
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
