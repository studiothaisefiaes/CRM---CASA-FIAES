import Link from "next/link";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/cn";

/**
 * Configurações › Pessoas (F5: um lugar só): a equipe com as assinaturas, quem recebe conversa nova primeiro e os perfis de acesso.
 * Cada pessoa vê só as partes que pode abrir; com uma parte só, a fileira some.
 */
export function TeamTabs({ current, perms }: { current: "pessoas" | "distribuicao" | "perfis" | "setores"; perms: readonly string[] }) {
  const equipe = can(perms, "equipe.gerir"), setores = can(perms, "setores.gerir"), dist = can(perms, "config.diaadia") || can(perms, "config.sistema");
  const tabs = ([
    { v: "pessoas", label: "Pessoas", href: "/config/equipe", ok: equipe },
    { v: "distribuicao", label: "Quem recebe conversa nova", href: "/config/distribuicao", ok: dist },
    { v: "perfis", label: "Perfis de acesso", href: "/config/equipe/perfis", ok: equipe },
    { v: "setores", label: "Setores", href: "/config/equipe/setores", ok: setores },
  ] as const).filter((t) => t.ok);
  if (tabs.length < 2) return null;
  return (
    <nav aria-label="Pessoas" className="mb-4 flex flex-wrap gap-1.5">
      {tabs.map((t) => (
        <Link key={t.v} href={t.href} aria-current={t.v === current ? "page" : undefined}
          className={cn("inline-flex items-center h-9 pointer-coarse:min-h-11 px-3.5 rounded-full border text-sm font-medium",
            t.v === current ? "bg-ink text-paper border-ink" : "bg-paper text-graphite border-control hover:border-graphite hover:text-ink")}>{t.label}</Link>
      ))}
    </nav>
  );
}
