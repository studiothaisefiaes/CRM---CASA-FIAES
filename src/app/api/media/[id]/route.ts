import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { findSessionUserCached } from "@/server/auth/sessions-store";
import { fileEtag, matchesEtag } from "@/server/http/etag";
import { isUuid } from "@/lib/uuid";
import { db } from "@/server/db";
import { messages } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { ensureMedia, readMediaFile } from "@/server/whatsapp/media";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";
import { parseRange } from "@/server/http-range";
import { IMAGE_THUMB_PX, thumbnail } from "@/server/whatsapp/thumbs";
import { assertCanActOnMessage } from "@/server/domain/deal-scope";
import { UserFacingError } from "@/server/domain/errors";
import { stat } from "node:fs/promises";
import path from "node:path";

// Foto/áudio/figurinha de uma mensagem. Áudio: serve a cópia .m4a (toca no Safari/iPhone) quando existe; `?original=1` força o original.
// Range (206) para o player poder buscar e saber a duração.
// Só para quem está logado; arquivo fica no disco do servidor. Conteúdo fixo por id: cache longo, ETag (304 sem ler o arquivo)
// e a sessão guardada por 5 s (uma conversa pede várias mídias de uma vez).
// `?thumb=1` (o balão da foto): miniatura WebP de até 720 px (~1/4 dos bytes); o link "abrir" continua no original. Só foto JPEG/PNG/WebP;
// o resto (áudio, vídeo, GIF, figurinha) ignora o parâmetro.
const IMMUTABLE = "private, max-age=31536000, immutable";
export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[id]">) {
  const user = await findSessionUserCached(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  // Conversa e ficha: só quem vê o Atendimento ou os Contatos.
  if (!can(user.perms, "atendimento.ver") && !can(user.perms, "contatos.ver")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  // Com "só as próprias conversas" ligado (desligado por padrão), a mídia da conversa de outra colega é recusada como as demais ações.
  try { await assertCanActOnMessage(user, id); } catch (e) { if (e instanceof UserFacingError) return new Response("sem permissão", { status: 403 }); throw e; }
  const [mm] = await db.select({ purgedAt: messages.mediaPurgedAt, playbackPath: messages.playbackPath }).from(messages).where(eq(messages.id, id)).limit(1);
  if (mm?.purgedAt) return new Response("mídia expirada", { status: 410 });
  const f = await ensureMedia(id);
  if (!f) return new Response("mídia indisponível", { status: 404 });
  const copy = mm?.playbackPath && req.nextUrl.searchParams.get("original") !== "1" ? path.join(path.dirname(f.file), path.basename(mm.playbackPath)) : null;
  const useCopy = !!copy && (await stat(copy).then((s) => s.isFile(), () => false));
  const file = useCopy ? copy! : f.file;
  if (req.nextUrl.searchParams.get("thumb") === "1" && !useCopy) {
    const t = await thumbnail(file, { px: IMAGE_THUMB_PX, square: false });
    if (t) {
      if (matchesEtag(req.headers.get("if-none-match"), t.etag)) return new Response(null, { status: 304, headers: { etag: t.etag, "cache-control": IMMUTABLE } });
      return new Response(new Uint8Array(t.data), { headers: { ...mediaHeaders("image/webp", "foto.webp"), etag: t.etag, "content-length": String(t.data.length) } });
    }
  }
  const etag = await fileEtag(file);
  if (etag && !req.headers.get("range") && matchesEtag(req.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers: { etag, "cache-control": IMMUTABLE } });
  }
  const data = await readMediaFile(file);
  // Tipo pelos bytes também na hora de servir (arquivos antigos foram gravados com o mimetype declarado).
  const headers = { ...mediaHeaders(sniffMime(data.subarray(0, 256 * 1024)), useCopy ? path.basename(copy!) : f.name), "accept-ranges": "bytes", ...(etag ? { etag } : {}) };
  const range = parseRange(req.headers.get("range"), data.length);
  if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${data.length}` } });
  if (range) {
    const part = data.subarray(range.start, range.end + 1);
    return new Response(new Uint8Array(part), { status: 206, headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${data.length}`, "content-length": String(part.length) } });
  }
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
