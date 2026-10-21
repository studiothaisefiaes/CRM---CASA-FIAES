import type { NextRequest } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { findSessionUserCached } from "@/server/auth/sessions-store";
import { isUuid } from "@/lib/uuid";
import { db } from "@/server/db";
import { libraryFiles } from "@/server/db/schema";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";
import { IMAGE_THUMB_PX, thumbnail } from "@/server/whatsapp/thumbs";
import { readMediaFile } from "@/server/whatsapp/media";
import { safeMediaFile } from "@/server/whatsapp/retention";

// Arquivo da Biblioteca (miniatura com ?thumb=1). Só para quem gere ou envia a Biblioteca; apagado = 404.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/biblioteca/[id]">) {
  const user = await findSessionUserCached(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "biblioteca.gerir") && !can(user.perms, "biblioteca.enviar")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const [row] = await db.select().from(libraryFiles).where(and(eq(libraryFiles.id, id), isNull(libraryFiles.deletedAt)));
  const file = row ? safeMediaFile(row.path) : null;
  if (!row || !file) return new Response("não encontrado", { status: 404 });
  if (req.nextUrl.searchParams.get("thumb") === "1" && row.kind === "image") {
    const t = await thumbnail(file, { px: IMAGE_THUMB_PX, square: false });
    if (t) return new Response(new Uint8Array(t.data), { headers: { ...mediaHeaders("image/webp", "foto.webp"), etag: t.etag, "content-length": String(t.data.length) } });
  }
  const data = await readMediaFile(file).catch(() => null);
  if (!data) return new Response("não encontrado", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { ...mediaHeaders(sniffMime(data.subarray(0, 256 * 1024)), row.name), "content-length": String(data.length) } });
}
