import { requireUser } from "@/server/auth/session";
import { getMyAlerts } from "@/server/queries/alerts";
import { getShellBanners } from "@/server/queries/banners";
import { countLateLeads } from "@/server/queries/late-count";
import { Sidebar } from "@/components/shell/sidebar";
import { LiveProvider, LiveRefresh } from "@/components/shell/live";
import { LateWatch } from "@/components/shell/late-watch";
import { ShellBannersView } from "@/components/shell/connection-banner";
import { ToastProvider } from "@/components/ui/toast";
import { HoursProvider } from "@/components/pipeline/timer";
import { getBusinessHours } from "@/server/rules/engine";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [alerts, hours, banners, late] = await Promise.all([getMyAlerts(user), getBusinessHours(), getShellBanners(), countLateLeads(user)]);
  return (
    <ToastProvider>
      <LiveProvider>
        <HoursProvider hours={hours}>
          <Sidebar user={user} alerts={alerts} />
          <LateWatch initial={late} />
          {/* Banners de conexão (channels) vêm do servidor; o sino busca /api/alertas sozinho (useLiveAlerts) e o atrasado, /api/alertas/atrasados. */}
          <LiveRefresh scopes={["channels"]} />
          <div className="lg:pl-[232px] min-h-dvh pb-20 lg:pb-0">
            <ShellBannersView banners={banners} role={user.role} />
            {children}
          </div>
        </HoursProvider>
      </LiveProvider>
    </ToastProvider>
  );
}
