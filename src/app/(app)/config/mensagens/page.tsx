import { eq } from "drizzle-orm";
import { db } from "@/server/db";
import { settings } from "@/server/db/schema";
import { getBusinessHours } from "@/server/domain/hours";
import { getAutoReply } from "@/server/domain/messaging-settings";
import { summarizeHours } from "@/lib/hours-summary";
import { AutoReplyEditor } from "@/components/config/messages";

export const metadata = { title: "Mensagens automáticas" };

export default async function MensagensPage() {
  const [reply, hours, savedHours] = await Promise.all([getAutoReply(), getBusinessHours(), db.select({ key: settings.key }).from(settings).where(eq(settings.key, "business_hours"))]);
  return <AutoReplyEditor initial={reply} hoursSummary={summarizeHours(hours)} hoursSaved={savedHours.length > 0} />;
}
