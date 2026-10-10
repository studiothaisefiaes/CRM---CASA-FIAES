import { requireUser } from "@/server/auth/session";
import { getMyAlerts } from "@/server/queries/alerts";
import { getShellBanners } from "@/server/queries/banners";
import { Sidebar } from "@/components/shell/sidebar";
import { LiveProvider } from "@/components/shell/live";
import { LateWatch } from "@/components/shell/late-watch";
import { ShellBannersView } from "@/components/shell/connection-banner";
import { ToastProvider } from "@/components/ui/toast";
import { HoursProvider } from "@/components/pipeline/timer";
import { getBusinessHours } from "@/server/rules/engine";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const [alerts, hours, banners] = await Promise.all([getMyAlerts(user), getBusinessHours(), getShellBanners()]);
  return (
    <ToastProvider>
      <LiveProvider>
        <HoursProvider hours={hours}>
          <Sidebar user={user} alerts={alerts} />
          <LateWatch alerts={alerts} />
          <div className="lg:pl-[232px] min-h-dvh pb-20 lg:pb-0">
            <ShellBannersView banners={banners} role={user.role} />
            {children}
          </div>
        </HoursProvider>
      </LiveProvider>
    </ToastProvider>
  );
}
