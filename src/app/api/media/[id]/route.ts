import type { NextRequest } from "next/server";
import { findSessionUser } from "@/server/auth/sessions-store";
import { ensureMedia, readMediaFile } from "@/server/whatsapp/media";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";

// Foto/áudio/figurinha de uma mensagem. Só para quem está logado; arquivo fica no disco do servidor.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/media/[id]">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("não encontrado", { status: 404 });
  const f = await ensureMedia(id);
  if (!f) return new Response("mídia indisponível", { status: 404 });
  const data = await readMediaFile(f.file);
  // Tipo pelos bytes também na hora de servir (arquivos antigos foram gravados com o mimetype declarado).
  const headers = mediaHeaders(sniffMime(data.subarray(0, 256 * 1024)), f.name);
  return new Response(new Uint8Array(data), { headers: { ...headers, "content-length": String(data.length) } });
}
