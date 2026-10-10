import type { NextRequest } from "next/server";
import path from "node:path";
import { eq } from "drizzle-orm";
import { findSessionUser } from "@/server/auth/sessions-store";
import { isUuid } from "@/lib/uuid";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { mediaDir, readMediaFile } from "@/server/whatsapp/media";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";

// Foto de perfil do WhatsApp do contato (baixada pelo worker).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/avatar/[id]">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const [c] = await db.select({ p: contacts.avatarPath }).from(contacts).where(eq(contacts.id, id));
  if (!c?.p) return new Response("sem foto", { status: 404 });
  const data = await readMediaFile(path.join(mediaDir(), c.p)).catch(() => null);
  if (!data) return new Response("sem foto", { status: 404 });
  // Foto de perfil só pode ser imagem; o resto vira download binário.
  const sniffed = sniffMime(data.subarray(0, 32));
  const headers = mediaHeaders(sniffed?.startsWith("image/") ? sniffed : null, c.p);
  // A foto troca na mesma URL (o worker revisa a cada 7 dias): cache de 1 dia, sem immutable.
  return new Response(new Uint8Array(data), { headers: { ...headers, "cache-control": "private, max-age=86400", "content-length": String(data.length) } });
}
