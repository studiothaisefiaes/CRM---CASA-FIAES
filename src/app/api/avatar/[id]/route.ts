import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import path from "node:path";
import { eq } from "drizzle-orm";
import { findSessionUserCached } from "@/server/auth/sessions-store";
import { isUuid } from "@/lib/uuid";
import { db } from "@/server/db";
import { contacts } from "@/server/db/schema";
import { mediaDir, readMediaFile } from "@/server/whatsapp/media";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";
import { fileEtag, matchesEtag } from "@/server/http/etag";
import { AVATAR_THUMB_PX, thumbnail } from "@/server/whatsapp/thumbs";

// Foto de perfil do WhatsApp do contato (baixada pelo worker; a rota nunca fala com a Evolution).
// A Fila pede dezenas de uma vez: a sessão fica guardada por 5 s (findSessionUserCached) e o navegador revalida por ETag (304, sem ler o arquivo).
// Padrão: a miniatura WebP de 128 px (~3 KB; o original tem em média 51 KB e é mostrado com 28–52 px). `?full=1`: o original (foto ampliada).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/avatar/[id]">) {
  const user = await findSessionUserCached(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  // Conversa e ficha: só quem vê o Atendimento ou os Contatos.
  if (!can(user.perms, "atendimento.ver") && !can(user.perms, "contatos.ver")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const [c] = await db.select({ p: contacts.avatarPath }).from(contacts).where(eq(contacts.id, id));
  if (!c?.p) return new Response("sem foto", { status: 404 });
  const file = path.join(mediaDir(), c.p);
  // Com versão (?v=, a data em que o worker revisou a foto): a URL muda quando a foto muda, então vale cache longo e imutável.
  // Sem versão a foto troca na mesma URL (o worker revisa a cada 7 dias): cache de 1 dia.
  const cache = req.nextUrl.searchParams.get("v") ? "private, max-age=31536000, immutable" : "private, max-age=86400";
  if (req.nextUrl.searchParams.get("full") !== "1") {
    const t = await thumbnail(file, { px: AVATAR_THUMB_PX, square: true });
    if (t) {
      if (matchesEtag(req.headers.get("if-none-match"), t.etag)) return new Response(null, { status: 304, headers: { etag: t.etag, "cache-control": cache } });
      return new Response(new Uint8Array(t.data), { headers: { ...mediaHeaders("image/webp", "foto.webp"), etag: t.etag, "cache-control": cache, "content-length": String(t.data.length) } });
    }
    // Não deu miniatura (não é JPEG/PNG/WebP): segue com o original, como antes.
  }
  const etag = await fileEtag(file);
  if (!etag) return new Response("sem foto", { status: 404 });
  if (matchesEtag(req.headers.get("if-none-match"), etag)) return new Response(null, { status: 304, headers: { etag, "cache-control": cache } });
  const data = await readMediaFile(file).catch(() => null);
  if (!data) return new Response("sem foto", { status: 404 });
  // Foto de perfil só pode ser imagem; o resto vira download binário.
  const sniffed = sniffMime(data.subarray(0, 32));
  const headers = mediaHeaders(sniffed?.startsWith("image/") ? sniffed : null, c.p);
  return new Response(new Uint8Array(data), { headers: { ...headers, etag, "cache-control": cache, "content-length": String(data.length) } });
}
