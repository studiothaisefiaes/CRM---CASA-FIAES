import type { Metadata } from "next";
import { requirePerm } from "@/server/auth/session";
import { resolvePro } from "@/server/queries/pro";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmNoShowProvider } from "@/components/ui/confirm-no-show";
import { LiveProvider, LiveRefresh } from "@/components/shell/live";
import { RenewSession } from "@/components/pro/renew-session";
import { VersionWatch } from "@/components/shell/version-watch";
import { buildId } from "@/server/build-id";
import { ProShell, ProSignOut, type ProNavItem } from "@/components/pro/pro-shell";
import { firstName } from "@/lib/authorship";
import { titleCase } from "@/lib/pro-day";
import { shiftDay, todayBahia } from "@/lib/agenda";
import { unreadCount } from "@/server/domain/pro/notifications";
import { can } from "@/lib/permissions";
import { caixaOn } from "@/server/domain/agenda/ports";

export const metadata: Metadata = {
  title: { default: "Minha agenda", template: "%s · Minha agenda" },
  // Manifesto próprio (public/pro.webmanifest): instalado na tela inicial abre direto em /pro.
  manifest: "/pro.webmanifest",
  appleWebApp: { capable: true, title: "Minha agenda", statusBarStyle: "default" },
};

/**
 * App da profissional (Lote 7A): sem o menu da equipe, sem sino de conversas e sem presença da distribuição (nada de `beat()`).
 * A profissional é sempre a da sessão. Sem ligação com uma profissional ativa, só o aviso.
 */
export default async function ProLayout({ children }: LayoutProps<"/pro">) {
  const user = await requirePerm("pro.app");
  const pro = await resolvePro(user.id);
  if (!pro) return (
    <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col justify-center gap-4 px-5">
      <h1 className="font-display text-2xl leading-tight">Olá, {firstName(user.name) ?? "tudo bem"}!</h1>
      <p role="status" className="text-graphite">Sua conta ainda não está ligada a uma profissional. Fale com a gestão.</p>
      <div><ProSignOut /></div>
    </main>
  );
  const tomorrow = shiftDay(todayBahia(new Date()), 1);
  const unread = await unreadCount(pro);
  // Ganhos só com `pro.ganhos` e o caixa no CRM (com o 6C neste banco).
  const earnings = can(user.perms, "pro.ganhos") && (await caixaOn());
  const nav: ProNavItem[] = [
    { href: "/pro", label: "Hoje" }, { href: `/pro/dia/${tomorrow}`, label: "Amanhã" }, { href: "/pro/semana", label: "Semana" },
    { href: "/pro/folga", label: "Folga" },
    { href: "/pro/avisos", label: unread ? `Avisos (${unread})` : "Avisos" },
    ...(earnings ? [{ href: "/pro/ganhos", label: "Ganhos" }] : []),
  ];
  return (
    <ToastProvider>
      <ConfirmNoShowProvider>
      <LiveProvider>
        <LiveRefresh scopes={["agenda"]} />
        <RenewSession />
        <VersionWatch versao={buildId()} />
        <ProShell name={titleCase(pro.name)} nav={nav}>{children}</ProShell>
      </LiveProvider>
      </ConfirmNoShowProvider>
    </ToastProvider>
  );
}
