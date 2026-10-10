import { and, asc, eq, isNotNull } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/server/db";
import { channels } from "@/server/db/schema";
import { requireGestor } from "@/server/auth/session";
import { notRemovedChannel } from "@/server/whatsapp/channel-removed";
import { listSources, sourceLink } from "@/server/domain/sources";
import { SourcesEditor, type SourceRow } from "@/components/config/sources";
export const metadata = { title: "Origens" };

const QR_COLORS = { dark: "#121212", light: "#ffffff" };

export default async function OrigensPage() {
  await requireGestor();
  const [channel] = await db.select({ phone: channels.phone }).from(channels)
    .where(and(eq(channels.status, "conectado"), isNotNull(channels.phone), notRemovedChannel)).orderBy(asc(channels.createdAt)).limit(1);
  const phone = channel?.phone ?? null;
  const rows: SourceRow[] = await Promise.all((await listSources()).map(async (s) => {
    const link = phone ? sourceLink(s, phone) : null;
    return {
      id: s.id, code: s.code, label: s.label, kind: s.kind, prefill: s.prefill, active: s.active, link,
      svg: link ? await QRCode.toString(link, { type: "svg", margin: 2, color: QR_COLORS }) : null,
      png: link ? await QRCode.toDataURL(link, { width: 1024, margin: 2, color: QR_COLORS }) : null,
    };
  }));
  return <SourcesEditor sources={rows} hasChannel={!!phone} />;
}
