import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { findSessionUser } from "@/server/auth/sessions-store";
import { isUuid } from "@/lib/uuid";
import { readQuickReplyFile } from "@/server/domain/quick-replies";
import { mediaHeaders, sniffMime } from "@/server/security/sniff";

/** Anexo de uma resposta pronta (prévia em Configurações). Só para quem atende ou configura. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "atendimento.ver") && !can(user.perms, "config.diaadia")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const f = await readQuickReplyFile(id);
  if (!f) return new Response("anexo indisponível", { status: 404 });
  const headers = mediaHeaders(sniffMime(f.data.subarray(0, 256 * 1024)), f.att.name);
  return new Response(new Uint8Array(f.data), { headers: { ...headers, "content-length": String(f.data.length) } });
}
