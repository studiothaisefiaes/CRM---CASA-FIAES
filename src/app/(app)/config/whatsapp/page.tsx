import { desc } from "drizzle-orm";
import { db } from "@/server/db";
import { channels } from "@/server/db/schema";
import { WhatsAppChannels } from "@/components/config/whatsapp";
export const metadata = { title: "WhatsApp" };
export default async function WhatsAppPage() {
  const rows = await db.select().from(channels).orderBy(desc(channels.createdAt));
  return <WhatsAppChannels channels={rows.filter((c) => !c.name.endsWith("(removido)")).map((c) => ({ id: c.id, name: c.name, status: c.status, phone: c.phone, lastEventAt: c.lastEventAt?.toISOString() ?? null }))} />;
}
