import Link from "next/link";
import { CONTACT_TAB_LABEL, type ContactTab } from "@/lib/contact-list-params";
import { cn } from "@/lib/cn";

const TABS: (ContactTab | null)[] = [null, "metodo", "gerais"];

/**
 * O filtro do tipo de cliente: Todas · Método Fiaes · Serviços gerais, cada um com quantas tem (com a busca e os filtros de agora).
 * É filtro dentro da lista, então tem a cara de pílula (dsgfix: um só nível de abas sublinhadas por tela, as do cabeçalho).
 */
export function ClientTabs({ current, counts, hrefFor }: { current: ContactTab | null; counts: { todas: number; metodo: number; gerais: number }; hrefFor: (tab: ContactTab | null) => string }) {
  return (
    <nav aria-label="Tipo de cliente" className="mb-3 inline-flex max-w-full gap-1 overflow-x-auto rounded-[var(--radius-control)] bg-paper-2 p-1 scroll-thin max-sm:[mask-image:linear-gradient(to_right,#000_calc(100%-32px),transparent)] max-sm:pr-8">
      {TABS.map((t) => {
        const on = current === t;
        return (
          <Link key={t ?? "todas"} href={hrefFor(t)} aria-current={on ? "page" : undefined}
            className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-sm font-medium transition-colors pointer-coarse:min-h-11",
              on ? "border border-line bg-paper text-ink shadow-[var(--shadow-card)]" : "text-graphite hover:text-ink")}>
            {CONTACT_TAB_LABEL[t ?? "todas"]}<span className={cn("tabular text-xs", on ? "text-ink-2" : "text-muted")}>{counts[t ?? "todas"].toLocaleString("pt-BR")}</span>
          </Link>
        );
      })}
    </nav>
  );
}
