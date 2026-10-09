import { requireUser } from "@/server/auth/session";
import { getMyAlerts } from "@/server/queries/alerts";
import { Sidebar } from "@/components/shell/sidebar";
import { LiveProvider } from "@/components/shell/live";
import { ToastProvider } from "@/components/ui/toast";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const alerts = await getMyAlerts(user);
  return (
    <ToastProvider>
      <LiveProvider>
        <Sidebar user={user} alerts={alerts} />
        <div className="lg:pl-[232px] min-h-dvh pb-20 lg:pb-0">{children}</div>
      </LiveProvider>
    </ToastProvider>
  );
}
