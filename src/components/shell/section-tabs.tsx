import Link from "next/link";
import { tabClass, tabListClass } from "@/components/ui/tab-styles";
import type { SectionTab } from "@/lib/section-tabs";

/** As visões de uma tela, como links (a visão fica no endereço e o "voltar" funciona). Uma só visão = nada a trocar, não aparece. */
export function SectionTabs({ label, tabs, current, className }: { label: string; tabs: SectionTab[]; current: string; className?: string }) {
  if (tabs.length < 2) return null;
  return (
    <nav aria-label={label} className={tabListClass(className)}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={t.key === current ? "page" : undefined}
          className={tabClass(t.key === current)}>{t.label}</Link>
      ))}
    </nav>
  );
}
