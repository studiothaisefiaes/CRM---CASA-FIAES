"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { IconChart, IconChat, IconContacts, IconFunnel, IconJourney, IconLogout, IconMore, IconSettings, IconToday } from "@/components/icons";
import { Sheet } from "@/components/ui/sheet";
import { AlertsBell } from "./alerts-bell";
import { SoundUnlockHint } from "./sound-hint";
import { useLiveAlerts } from "./use-live-alerts";
import { logoutAction } from "./push-cleanup";
import { initials } from "@/lib/format";
import { isConversationPath } from "@/lib/lead-href";
import { SPRING_UI } from "@/lib/motion";
import type { AlertItem } from "@/server/queries/alerts";

/** O Quadro (/funil) fica dentro de Atendimento: acende o mesmo item da barra. */
const MATCH: Record<string, string[]> = { "/atendimento": ["/atendimento", "/funil"] };

const NAV = [
  { href: "/", label: "Hoje", icon: IconToday },
  { href: "/atendimento", label: "Atendimento", icon: IconChat },
  { href: "/contatos", label: "Contatos", icon: IconContacts },
  { href: "/relatorios", label: "Relatórios", icon: IconChart },
];

export function Sidebar({ user, alerts: initialAlerts }: { user: { name: string; role: string }; alerts: AlertItem[] }) {
  const path = usePathname();
  const { alerts, reload } = useLiveAlerts(initialAlerts);
  const [more, setMore] = useState(false);
  const gestor = user.role === "gestor";
  const items = gestor ? [...NAV, { href: "/jornada", label: "Jornada", icon: IconJourney }, { href: "/config", label: "Configurações", icon: IconSettings }] : NAV;
  const isActive = (href: string) => (href === "/" ? path === "/" : (MATCH[href] ?? [href]).some((p) => path.startsWith(p)));
  // Conversa em tela cheia no celular: sem barra superior nem inferior (o cabeçalho do lead tem o voltar; o sino e o Sair ficam a um toque, na Fila).
  const conversation = isConversationPath(path);
  const hasUnread = alerts.some((a) => !a.read);
  const moreActive = path.startsWith("/config") || path.startsWith("/jornada"); // /funil (Quadro) acende Atendimento, não "Mais"
  return (
    <>
      <aside className="hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col bg-paper-2 border-r border-line z-30">
        <div className="flex items-center justify-between px-5 pt-5 pb-6">
          <Link href="/" className="font-serif text-[21px] leading-none">Casa <em className="text-gold-ink">Fiaes</em></Link>
          <AlertsBell alerts={alerts} reload={reload} />
        </div>
        <SoundUnlockHint show={hasUnread} className="self-end mx-3 -mt-5 mb-2" />
        <nav className="flex-1 px-3 flex flex-col gap-0.5" aria-label="Principal">
          {items.map((it) => {
            const active = isActive(it.href);
            return (
              <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined}
                className={`relative flex items-center gap-3 h-10 px-3 rounded-[var(--radius-control)] text-base transition-colors ${active ? "text-ink font-medium" : "text-graphite hover:text-ink hover:bg-paper-3/60"}`}>
                {active && <motion.span layoutId="nav-pill" transition={SPRING_UI} className="absolute inset-0 rounded-[var(--radius-control)] bg-paper border border-line shadow-[var(--shadow-card)]" />}
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
          <form action={logoutAction}><button className="size-8 grid place-items-center rounded-[8px] text-muted hover:text-ink hover:bg-paper-3" aria-label="Sair"><IconLogout size={17} /></button></form>
        </div>
      </aside>

      {/* Celular: barra superior + navegação inferior */}
      {!conversation && <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] bg-paper/90 backdrop-blur border-b border-line">
        <Link href="/" className="font-serif text-[19px] inline-block py-3">Casa <em className="text-gold-ink">Fiaes</em></Link>
        <div className="flex items-center gap-1">
          <SoundUnlockHint show={hasUnread} />
          <AlertsBell alerts={alerts} reload={reload} />
          <form action={logoutAction}><button className="size-11 grid place-items-center rounded-[var(--radius-control)] text-muted" aria-label="Sair"><IconLogout size={17} /></button></form>
        </div>
      </header>}
      {!conversation && <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 bg-paper/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]" aria-label="Principal">
        {NAV.map((it) => {
          const active = isActive(it.href);
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] ${active ? "text-ink font-medium" : "text-muted"}`}>
              {active && <motion.span layoutId="tab-dot" transition={SPRING_UI} className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />}
              <it.icon size={20} />{it.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 text-[11px] ${moreActive ? "text-ink font-medium" : "text-muted"}`}>
          {moreActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />}
          <IconMore size={20} />Mais
        </button>
      </nav>}
      <Sheet open={more} onClose={() => setMore(false)} title="Mais" side="bottom">
        <ul className="flex flex-col -my-1">
          <li><Link href="/funil" onClick={() => setMore(false)} className="flex items-center gap-3 min-h-12 text-base"><IconFunnel size={19} className="text-graphite" />Quadro de leads</Link></li>
          {gestor && <li><Link href="/jornada" onClick={() => setMore(false)} className="flex items-center gap-3 min-h-12 text-base"><IconJourney size={19} className="text-graphite" />Jornada</Link></li>}
          {gestor && <li><Link href="/config" onClick={() => setMore(false)} className="flex items-center gap-3 min-h-12 text-base"><IconSettings size={19} className="text-graphite" />Configurações</Link></li>}
          <li><form action={logoutAction}><button className="flex w-full items-center gap-3 min-h-12 text-base text-left"><IconLogout size={19} className="text-graphite" />Sair</button></form></li>
        </ul>
        <p className="text-xs text-muted mt-3">{user.name} · {gestor ? "Gestão" : "Atendimento"}</p>
      </Sheet>
    </>
  );
}
