import path from "node:path";
import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { findSessionUser } from "@/server/auth/sessions-store";
import { findClientPhotoFile } from "@/server/domain/client-photos";
import { isFuncaoOn } from "@/server/domain/funcoes";
import { mediaDir, readMediaFile } from "@/server/whatsapp/media";
import { photoHeaders, type PhotoMime } from "@/server/security/sniff";

/**
 * Foto de antes e depois da cliente. Dado da cliente: pede sessão e fichas.ver (contatos.ver sozinho não basta), só serve com a função
 * "fotos" ligada e nunca fica em cache. Foto apagada, de outra cliente ou fora da pasta galeria/: 404.
 */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/contatos/[id]/fotos/[photoId]">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const { id, photoId } = await ctx.params;
  if (!isUuid(id) || !isUuid(photoId)) return new Response("não encontrado", { status: 404 });
  if (!(await isFuncaoOn("fotos"))) return new Response("não encontrado", { status: 404 });
  if (!can(user.perms, "fichas.ver")) return new Response("sem permissão", { status: 403 });
  const p = await findClientPhotoFile(id, photoId);
  if (!p) return new Response("não encontrado", { status: 404 });
  const file = path.resolve(mediaDir(), p.mediaPath);
  if (!file.startsWith(path.resolve(mediaDir(), "galeria") + path.sep)) return new Response("não encontrado", { status: 404 });
  const data = await readMediaFile(file).catch(() => null);
  if (!data) return new Response("não encontrado", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { ...photoHeaders(p.mediaMime as PhotoMime), "cache-control": "private, no-store", "content-length": String(data.length) } });
}
