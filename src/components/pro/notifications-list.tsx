"use client";
import { useEffect } from "react";
import Link from "next/link";
import { markNotificationsReadAction } from "@/app/(pro)/pro/actions";
import type { ProNotificationItem } from "@/server/domain/pro/notifications";
import { dueLabel } from "@/lib/next-action";
import { cn } from "@/lib/cn";

/** Os avisos das últimas 48 h. Abrir a tela marca como lidos. */
export function NotificationsList({ items, nowMs }: { items: ProNotificationItem[]; nowMs: number }) {
  useEffect(() => { if (items.some((i) => !i.read)) void markNotificationsReadAction(); }, [items]);
  if (!items.length) return <p className="text-graphite">Nenhum aviso nas últimas 48 horas.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((n) => (
        <li key={n.id}>
          <Link href={n.url} className={cn("flex min-h-12 flex-col rounded-[var(--radius-card)] border px-3 py-2 hover:bg-paper-2", n.read ? "border-line" : "border-gold bg-gold-soft/40")}>
            <span className="flex justify-between gap-2"><span className="font-medium">{n.title}</span><span className="text-xs text-graphite">{dueLabel(Date.parse(n.at), nowMs)}</span></span>
            <span className="text-sm text-graphite">{n.body}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
