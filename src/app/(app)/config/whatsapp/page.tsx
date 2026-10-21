import { requirePerm } from "@/server/auth/session";
import { desc } from "drizzle-orm";
import { db } from "@/server/db";
import { channels } from "@/server/db/schema";
import { isRemovedChannel } from "@/server/whatsapp/channel-removed";
import { getMediaRetentionMonths, getSendCap } from "@/server/domain/messaging-settings";
import { WhatsAppChannels, type Retention } from "@/components/config/whatsapp";
export const metadata = { title: "Conexão do WhatsApp" };
export default async function WhatsAppPage() {
  await requirePerm("config.sistema");
  const [rows, sendCap, months] = await Promise.all([db.select().from(channels).orderBy(desc(channels.createdAt)), getSendCap(), getMediaRetentionMonths()]);
  const now = new Date();
  return <WhatsAppChannels sendCap={sendCap} retention={(months ?? "nunca") as Retention}
    channels={rows.filter((c) => !isRemovedChannel(c.name)).map((c) => ({ id: c.id, name: c.name, status: c.status, phone: c.phone, lastEventAt: c.lastEventAt?.toISOString() ?? null, quietUntil: c.quietUntil && c.quietUntil > now ? c.quietUntil.toISOString() : null }))} />;
}
