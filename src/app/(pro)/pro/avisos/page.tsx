import Link from "next/link";
import { requirePro } from "@/server/auth/pro-session";
import { listMyNotifications } from "@/server/domain/pro/notifications";
import { NotificationsList } from "@/components/pro/notifications-list";

export const metadata = { title: "Avisos" };

export default async function ProNotificationsPage() {
  const { pro } = await requirePro();
  if (!pro) return null;
  const now = new Date();
  return (
    <main className="flex flex-col gap-3">
      <h1 className="font-display text-xl">Avisos</h1>
      <p className="text-sm text-graphite">Os das últimas 48 horas, para quando o aviso no celular não chegar. <Link href="/pro/instalar" className="font-medium text-gold-ink underline-offset-4 hover:underline">Ligar os avisos neste aparelho</Link></p>
      <NotificationsList items={await listMyNotifications(pro, now)} nowMs={now.getTime()} />
    </main>
  );
}
