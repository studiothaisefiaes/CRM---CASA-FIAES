"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { IconChart, IconContacts, IconFunnel, IconLogout, IconSettings, IconToday } from "@/components/icons";
import { AlertsBell } from "./alerts-bell";
import { logout } from "@/app/login/actions";
import { initials } from "@/lib/format";
import { SPRING } from "@/lib/motion";
import type { AlertItem } from "@/server/queries/alerts";

const NAV = [
  { href: "/", label: "Hoje", icon: IconToday },
  { href: "/funil", label: "Funil", icon: IconFunnel },
  { href: "/contatos", label: "Contatos", icon: IconContacts },
  { href: "/relatorios", label: "Relatórios", icon: IconChart },
];

export function Sidebar({ user, alerts }: { user: { name: string; role: string }; alerts: AlertItem[] }) {
  const path = usePathname();
  const items = user.role === "gestor" ? [...NAV, { href: "/config", label: "Configurações", icon: IconSettings }] : NAV;
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col bg-paper-2 border-r border-line z-30">
        <div className="flex items-center justify-between px-5 pt-5 pb-6">
          <Link href="/" className="font-serif text-[21px] leading-none">Casa <em className="text-gold">Fiaes</em></Link>
          <AlertsBell alerts={alerts} />
        </div>
        <nav className="flex-1 px-3 flex flex-col gap-0.5" aria-label="Principal">
          {items.map((it) => {
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 h-10 px-3 rounded-[var(--radius-control)] text-base transition-colors ${active ? "text-ink font-medium" : "text-graphite hover:text-ink hover:bg-paper-3/60"}`}>
                {active && <motion.span layoutId="nav-pill" transition={SPRING} className="absolute inset-0 rounded-[var(--radius-control)] bg-paper border border-line shadow-[var(--shadow-card)]" />}
                <it.icon className="relative" /><span className="relative">{it.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-line flex items-center gap-3">
          <span className="size-8 rounded-full bg-ink text-paper grid place-items-center text-xs font-semibold">{initials(user.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted">{user.role === "gestor" ? "Gestão" : "Atendimento"}</p>
          </div>
          <form action={logout}><button className="size-8 grid place-items-center rounded-[8px] text-muted hover:text-ink hover:bg-paper-3" aria-label="Sair"><IconLogout size={17} /></button></form>
        </div>
      </aside>

      {/* Celular: barra superior + navegação inferior */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 px-4 bg-paper/90 backdrop-blur border-b border-line">
        <Link href="/" className="font-serif text-[19px]">Casa <em className="text-gold">Fiaes</em></Link>
        <div className="flex items-center gap-1">
          <AlertsBell alerts={alerts} />
          <form action={logout}><button className="size-9 grid place-items-center rounded-[var(--radius-control)] text-muted" aria-label="Sair"><IconLogout size={17} /></button></form>
        </div>
      </header>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid bg-paper/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]" style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }} aria-label="Principal">
        {items.map((it) => {
          const active = isActive(it.href);
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center gap-0.5 py-2 text-[10.5px] ${active ? "text-ink" : "text-muted"}`}>
              {active && <motion.span layoutId="tab-dot" transition={SPRING} className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />}
              <it.icon size={20} />{it.label.split(" ")[0]}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
