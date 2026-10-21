"use client";
import { useState } from "react";
import { AvailabilityMenu, MobileAvailability } from "./availability-menu";
import { can } from "@/lib/permissions";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { IconArrowRight, IconLogout, IconMore } from "@/components/icons";
import { activeNav, navFor, type NavItem } from "./nav";
import { Sheet } from "@/components/ui/sheet";
import { AlertsBell } from "./alerts-bell";
import { DemoBadge } from "./demo-badge";
import { SoundUnlockHint } from "./sound-hint";
import { useLiveAlerts } from "./use-live-alerts";
import { logoutAction } from "./push-cleanup";
import { useSidebarCollapsed } from "./sidebar-state";
import { initials } from "@/lib/format";
import { cn } from "@/lib/cn";
import { isConversationPath } from "@/lib/lead-href";
import { SPRING_UI } from "@/lib/motion";
import type { AlertItem } from "@/server/queries/alerts";


/** `demo`: ambiente de demonstração (DEMO=true), mostra a etiqueta "Demonstração" no menu e no cabeçalho do celular. */
export function Sidebar({ user, alerts: initialAlerts, demo = false, caixaOn = false, estoqueOn = false }: { user: { name: string; profileName: string; perms: readonly string[]; availability: string }; alerts: AlertItem[]; demo?: boolean; caixaOn?: boolean; estoqueOn?: boolean }) {
  const path = usePathname();
  const { alerts, reload } = useLiveAlerts(initialAlerts);
  const [more, setMore] = useState(false);
  // Itens de quem entrou. Um item aceso por vez; a troca de visões fica dentro de cada tela.
  const groups = navFor(user.perms, { caixaOn, estoqueOn });
  const all = [...groups.dia, ...groups.gestao];
  const on = activeNav(all, path ?? "");
  const receives = can(user.perms, "distribuicao.receber"); // entra na distribuição: escolhe o próprio estado
  // Conversa em tela cheia no celular: sem barra superior nem inferior (o cabeçalho do lead tem o voltar; o sino e o Sair ficam a um toque, na Fila).
  const conversation = isConversationPath(path);
  const hasUnread = alerts.some((a) => !a.read);
  // Celular: os itens "bar" na barra de baixo; o resto no "Mais" (Clientes e o grupo Gestão).
  const bottom = all.filter((it) => it.mobile === "bar");
  const extraDia = groups.dia.filter((it) => it.mobile === "mais"), extraGestao = groups.gestao.filter((it) => it.mobile === "mais");
  const moreActive = [...extraDia, ...extraGestao].some((it) => it.key === on.item); // Quadro acende Conversas; Jornada, Relatórios (no Mais)
  // Recolhível em todas as telas: em Conversas (Fila, Quadro) nasce encolhido; nas outras, aberto. A escolha fica guardada.
  const { collapsed, toggle } = useSidebarCollapsed();
  return (
    <>
      <aside className={cn("ds-congelada hidden lg:flex fixed inset-y-0 left-0 flex-col bg-paper-2 border-r border-line z-30 transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]", collapsed ? "w-[72px]" : "w-[232px]")}>
        <div className={cn("relative flex items-center pt-5 pb-6", collapsed ? "flex-col gap-3 px-2" : "justify-between px-5")}>
          <Link href="/" className="font-display text-xl leading-none whitespace-nowrap" title="Casa Fiaes">{collapsed ? <>C<em className="text-gold-ink">F</em></> : <>Casa <em className="text-gold-ink">Fiaes</em></>}</Link>
          <AlertsBell alerts={alerts} reload={reload} gestao={can(user.perms, "alertas.escalada")} />
          {/* Fora do fluxo: ao sumir (o próprio toque libera o som) nada da barra se mexe sob o cursor. */}
          {!collapsed && <SoundUnlockHint show={hasUnread} className="absolute right-3 top-14 lg:min-h-6" />}
        </div>
        <nav className={cn("flex-1 flex flex-col gap-0.5 overflow-y-auto", collapsed ? "px-2" : "px-3")} aria-label="Principal">
          {groups.dia.map((it) => <SideItem key={it.key} it={it} on={on} collapsed={collapsed} />)}
          {groups.gestao.length > 0 && (collapsed
            ? <><p className="sr-only">Gestão</p><div role="separator" className="mx-2 my-2 border-t border-line" /></>
            : <p className="mt-5 mb-1 px-3 text-xs text-muted">Gestão</p>)}
          {groups.gestao.map((it) => <SideItem key={it.key} it={it} on={on} collapsed={collapsed} />)}
        </nav>
        <button type="button" onClick={toggle} title={collapsed ? "Abrir menu" : "Encolher menu"}
          className={cn("mx-2 mb-2 flex h-9 items-center rounded-[var(--radius-control)] text-sm text-muted transition-colors hover:bg-paper-3/60 hover:text-ink", collapsed ? "justify-center" : "gap-2 px-3")}>
          <IconArrowRight size={16} className={cn("shrink-0 transition-transform", !collapsed && "rotate-180")} aria-hidden />
          <span className={collapsed ? "sr-only" : "whitespace-nowrap"}>{collapsed ? "Abrir menu" : "Encolher menu"}</span>
        </button>
        {demo && !collapsed && <div className="px-5 pb-3"><DemoBadge /></div>}
        <div className={cn("p-3 border-t border-line flex items-center", collapsed ? "flex-col gap-2" : "gap-3")}>
          <span className="size-8 shrink-0 rounded-full bg-ink text-paper grid place-items-center text-xs font-semibold" title={collapsed ? user.name : undefined}>{initials(user.name)}</span>
          {collapsed && receives && <AvailabilityMenu initial={user.availability} compact />}
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{user.name}</p>
              {receives ? <AvailabilityMenu initial={user.availability} /> : <p className="text-xs text-muted truncate">{user.profileName}</p>}
            </div>
          )}
          <form action={logoutAction}><button className="size-8 grid place-items-center rounded-[8px] text-muted hover:text-ink hover:bg-paper-3" aria-label="Sair"><IconLogout size={17} /></button></form>
        </div>
      </aside>

      {/* Celular: barra superior + navegação inferior */}
      {!conversation && <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between h-14 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] bg-paper/90 backdrop-blur border-b border-line">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/" className="font-display text-lg inline-block py-3 whitespace-nowrap">Casa <em className="text-gold-ink">Fiaes</em></Link>
          {demo && <DemoBadge />}
        </div>
        <div className="flex items-center gap-1">
          <SoundUnlockHint show={hasUnread} short />
          <AlertsBell alerts={alerts} reload={reload} gestao={can(user.perms, "alertas.escalada")} />
          <form action={logoutAction}><button className="size-11 grid place-items-center rounded-[var(--radius-control)] text-muted" aria-label="Sair"><IconLogout size={17} /></button></form>
        </div>
      </header>}
      {!conversation && <nav className="ds-congelada lg:hidden fixed bottom-0 inset-x-0 z-30 grid bg-paper/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]" aria-label="Principal" style={{ gridTemplateColumns: `repeat(${bottom.length + 1}, minmax(0, 1fr))` }}>
        {bottom.map((it) => {
          const active = on.item === it.key;
          return (
            <Link key={it.href} href={it.href} aria-current={active ? "page" : undefined} className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs ${active ? "text-ink font-medium" : "text-muted"}`}>
              {active && <motion.span layoutId="tab-dot" transition={SPRING_UI} className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />}
              <it.icon size={20} />{it.label}
            </Link>
          );
        })}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" className={`relative flex flex-col items-center justify-center gap-0.5 min-h-14 text-xs ${moreActive ? "text-ink font-medium" : "text-muted"}`}>
          {moreActive && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-gold" />}
          <IconMore size={20} />Mais
        </button>
      </nav>}
      <Sheet open={more} onClose={() => setMore(false)} title="Mais" side="bottom">
        <ul className="flex flex-col -my-1">
          {extraDia.map((it) => <MoreLink key={it.key} it={it} active={on.item === it.key} onClick={() => setMore(false)} />)}
          {extraGestao.length > 0 && <li data-group-title className="pt-3 pb-1 text-xs text-muted">Gestão</li>}
          {extraGestao.map((it) => <MoreLink key={it.key} it={it} active={on.item === it.key} onClick={() => setMore(false)} />)}
          <li><form action={logoutAction}><button className="flex w-full items-center gap-3 min-h-12 text-base text-left"><IconLogout size={19} className="text-graphite" />Sair</button></form></li>
        </ul>
        {receives && <MobileAvailability initial={user.availability} />}
        <p className="text-xs text-muted mt-3">{user.name} · {user.profileName}</p>
      </Sheet>
    </>
  );
}

/**
 * Um item do menu lateral: uma linha; aceso, mostra a pílula. Sem subtópicos (as visões ficam dentro da tela). Recolhido (só ícone), o nome
 * aparece na hora ao passar o mouse ou focar (r66 #13), numa dica fixa que a rolagem do menu não corta; o leitor de tela lê o nome sempre.
 */
function SideItem({ it, on, collapsed }: { it: NavItem; on: { item: string | null }; collapsed: boolean }) {
  const active = on.item === it.key;
  const [tip, setTip] = useState<{ top: number; left: number } | null>(null);
  const show = (el: HTMLElement) => { if (!collapsed) return; const r = el.getBoundingClientRect(); setTip({ top: r.top + r.height / 2, left: r.right + 8 }); };
  return (
    <Link href={it.href} aria-current={active ? "page" : undefined}
      onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setTip(null)} onFocus={(e) => show(e.currentTarget)} onBlur={() => setTip(null)}
      className={cn("relative flex items-center h-10 shrink-0 rounded-[var(--radius-control)] text-base transition-colors", collapsed ? "justify-center px-0" : "gap-3 px-3", active ? "text-ink font-medium" : "text-graphite hover:text-ink hover:bg-paper-3/60")}>
      {active && <motion.span layoutId="nav-pill" transition={SPRING_UI} className="absolute inset-0 rounded-[var(--radius-control)] bg-paper border border-line shadow-[var(--shadow-card)]" />}
      <it.icon className="relative shrink-0" /><span className={collapsed ? "sr-only" : "relative whitespace-nowrap"}>{it.label}</span>
      {collapsed && tip && <span role="tooltip" style={{ position: "fixed", top: tip.top, left: tip.left, transform: "translateY(-50%)" }}
        className="pointer-events-none z-[90] whitespace-nowrap rounded-[var(--radius-control)] bg-ink px-2.5 py-1.5 text-sm font-medium text-paper shadow-[var(--shadow-pop)]">{it.label}</span>}
    </Link>
  );
}

function MoreLink({ it, active, onClick }: { it: NavItem; active: boolean; onClick: () => void }) {
  return (
    <li>
      <Link href={it.href} onClick={onClick} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 min-h-12 text-base", active && "font-medium")}>
        <it.icon size={19} className="text-graphite" />{it.label}
      </Link>
    </li>
  );
}
