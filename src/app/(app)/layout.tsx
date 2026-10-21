import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { isProOnly } from "@/lib/permissions";
import { beat } from "@/server/domain/presence";
import { getMyAlerts } from "@/server/queries/alerts";
import { getShellBanners } from "@/server/queries/banners";
import { countLateLeads } from "@/server/queries/late-count";
import { Sidebar } from "@/components/shell/sidebar";
import { LiveProvider, LiveRefresh } from "@/components/shell/live";
import { LateWatch } from "@/components/shell/late-watch";
import { VersionWatch } from "@/components/shell/version-watch";
import { buildId } from "@/server/build-id";
import { AppFrame } from "@/components/shell/app-frame";
import { ShellBannersView } from "@/components/shell/connection-banner";
import { ToastProvider } from "@/components/ui/toast";
import { ConfirmNoShowProvider } from "@/components/ui/confirm-no-show";
import { HoursProvider } from "@/components/pipeline/timer";
import { getBusinessHours } from "@/server/rules/engine";
import { env } from "@/server/env";
import { getCaixaMode } from "@/server/domain/caixa/mode";
import { getEstoqueConfig } from "@/server/domain/estoque/config";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  // Lote 7A: quem só tem o app da profissional nunca abre as telas da equipe (nem conta como presença na distribuição).
  if (isProOnly(user.perms)) redirect("/pro");
  // Abrir qualquer tela do CRM conta como presença (distribuição): já abre "Disponível" sem esperar o tempo real.
  const availability = (await beat(user.id).catch(() => null)) ?? user.availability;
  const [alerts, hours, banners, late, caixaMode, estoque] = await Promise.all([getMyAlerts(user), getBusinessHours(), getShellBanners(), countLateLeads(user), getCaixaMode(), getEstoqueConfig()]);
  const caixaOn = caixaMode === "crm", estoqueOn = estoque.ligado;
  return (
    <ToastProvider>
      <ConfirmNoShowProvider>
      <LiveProvider>
        <HoursProvider hours={hours}>
          <Sidebar user={{ ...user, availability }} alerts={alerts} demo={env().DEMO} caixaOn={caixaOn} estoqueOn={estoqueOn} />
          <LateWatch initial={late} />
          {/* Versão nova do CRM (20/10): aviso "Atualizar" em vez de derrubar a tela. */}
          <VersionWatch versao={buildId()} />
          {/* Banners de conexão (channels) vêm do servidor; o sino busca /api/alertas sozinho (useLiveAlerts) e o atrasado, /api/alertas/atrasados. */}
          <LiveRefresh scopes={["channels", "team"]} />
          <AppFrame banners={<ShellBannersView banners={banners} perms={user.perms} />}>{children}</AppFrame>
        </HoursProvider>
      </LiveProvider>
      </ConfirmNoShowProvider>
    </ToastProvider>
  );
}
