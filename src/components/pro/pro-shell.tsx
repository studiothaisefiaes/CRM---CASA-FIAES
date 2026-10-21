"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { logoutAction } from "@/components/shell/push-cleanup";
import { cn } from "@/lib/cn";

export type ProNavItem = { href: string; label: string };

/** Sair do app: tira a inscrição de aviso deste aparelho e encerra a sessão (o mesmo do menu da equipe). */
export function ProSignOut() {
  return <button type="button" onClick={() => void logoutAction()} className="min-h-11 px-2 text-sm text-graphite hover:text-ink">Sair</button>;
}

/** Casca do app da profissional: barra de cima com o nome e menu de baixo, feito para o polegar. Sem menu da equipe nem sino. */
export function ProShell({ name, nav, children }: { name: string; nav: ProNavItem[]; children: ReactNode }) {
  const path = usePathname();
  const on = (href: string) => (href === "/pro" ? path === "/pro" : path.startsWith(href));
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[560px] flex-col bg-paper">
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur">
        <p className="font-display text-lg leading-tight">Minha agenda <span className="text-sm text-graphite">· {name}</span></p>
        <ProSignOut />
      </header>
      <div className="flex-1 px-4 pb-28 pt-4">{children}</div>
      <nav aria-label="App da profissional" className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto flex max-w-[560px] justify-around">
          {nav.map((i) => (
            <li key={i.href}>
              <Link href={i.href} aria-current={on(i.href) ? "page" : undefined}
                className={cn("inline-flex min-h-12 min-w-14 items-center justify-center px-2 text-sm", on(i.href) ? "font-semibold text-ink" : "text-graphite")}>{i.label}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
