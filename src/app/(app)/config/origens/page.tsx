import { and, asc, eq, isNotNull } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "@/server/db";
import { channels, lists } from "@/server/db/schema";
import { requirePerm } from "@/server/auth/session";
import { notRemovedChannel } from "@/server/whatsapp/channel-removed";
import { listSources, sourceLink } from "@/server/domain/sources";
import { SourcesEditor, type SourceRow } from "@/components/config/sources";
import { SimpleOrigins } from "@/components/config/origins";
export const metadata = { title: "Origens e links" };

const QR_COLORS = { dark: "#121212", light: "#ffffff" };

export default async function OrigensPage() {
  await requirePerm("config.diaadia");
  const [channel] = await db.select({ phone: channels.phone }).from(channels)
    .where(and(eq(channels.status, "conectado"), isNotNull(channels.phone), notRemovedChannel)).orderBy(asc(channels.createdAt)).limit(1);
  const phone = channel?.phone ?? null;
  const [srcs, simple] = await Promise.all([
    listSources(),
    db.select({ id: lists.id, label: lists.label, active: lists.active }).from(lists).where(eq(lists.kind, "origin")).orderBy(asc(lists.position), asc(lists.label)),
  ]);
  const rows: SourceRow[] = await Promise.all(srcs.map(async (s) => {
    const link = phone ? sourceLink(s, phone) : null;
    return {
      id: s.id, code: s.code, label: s.label, kind: s.kind, prefill: s.prefill, active: s.active, link,
      svg: link ? await QRCode.toString(link, { type: "svg", margin: 2, color: QR_COLORS }) : null,
      png: link ? await QRCode.toDataURL(link, { width: 1024, margin: 2, color: QR_COLORS }) : null,
    };
  }));
  return (
    <div className="flex flex-col gap-10">
      <SimpleOrigins items={simple} linked={srcs.map((s) => s.label)} />
      <section aria-labelledby="origens-links">
        <h2 id="origens-links" className="mb-1 text-lg font-semibold">Links e QR</h2>
        <SourcesEditor sources={rows} hasChannel={!!phone} />
      </section>
    </div>
  );
}
