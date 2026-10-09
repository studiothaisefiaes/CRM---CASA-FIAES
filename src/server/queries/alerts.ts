import { and, desc, eq, or, gte, isNull } from "drizzle-orm";
import { db } from "../db";
import { alerts, contacts, deals } from "../db/schema";
import type { SessionUser } from "../auth/sessions-store";

export async function getMyAlerts(user: SessionUser, limit = 30) {
  const mine = user.role === "gestor" ? or(eq(alerts.userId, user.id), eq(alerts.audience, "gestao")) : eq(alerts.userId, user.id);
  const rows = await db.select({ a: alerts, contactName: contacts.name, phone: contacts.phoneE164 }).from(alerts)
    .leftJoin(deals, eq(deals.id, alerts.dealId)).leftJoin(contacts, eq(contacts.id, deals.contactId))
    // Aviso de lead arquivado some junto (os avisos sem lead, como WhatsApp caiu, continuam).
    .where(and(mine, gte(alerts.createdAt, new Date(Date.now() - 7 * 86_400_000)), isNull(deals.archivedAt)))
    .orderBy(desc(alerts.createdAt)).limit(limit);
  return rows.map(({ a, contactName, phone }) => ({
    id: a.id, dealId: a.dealId, type: a.type, severity: a.severity, message: a.message, createdAt: a.createdAt.toISOString(),
    read: !!a.readAt || !!a.resolvedAt, resolved: !!a.resolvedAt, contactName, phone,
  }));
}
export type AlertItem = Awaited<ReturnType<typeof getMyAlerts>>[number];
