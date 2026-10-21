import type { NextRequest } from "next/server";
import { can } from "@/lib/permissions";
import { PHOTO_MAX_BYTES } from "@/lib/pro-photo";
import { findSessionUser } from "@/server/auth/sessions-store";
import { readProfessionalPhoto, saveProfessionalPhoto } from "@/server/domain/professional-photo";
import { UserFacingError } from "@/server/domain/errors";
import { mediaHeaders } from "@/server/security/sniff";

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Enviar a foto: a gestão (Configurações) ou quem marca na Agenda. Nunca devolve o caminho do disco. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/profissionais/[id]/foto">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return json({ error: "Entre de novo para enviar a foto." }, 401);
  if (!can(user.perms, "config.diaadia") && !can(user.perms, "agenda.marcar")) return json({ error: "Você não tem permissão para isso." }, 403);
  const { id } = await ctx.params;
  const form = await req.formData().catch(() => null);
  const file = form?.get("foto");
  if (!(file instanceof File) || file.size === 0) return json({ error: "Escolha uma foto." }, 400);
  if (file.size > PHOTO_MAX_BYTES) return json({ error: "A foto passa de 5 MB. Escolha uma menor." }, 413);
  try {
    return json(await saveProfessionalPhoto(id, new Uint8Array(await file.arrayBuffer()), user.id));
  } catch (e) {
    if (e instanceof UserFacingError) return json({ error: e.message }, 400);
    console.error("[foto da profissional]", e instanceof Error ? e.message : e);
    return json({ error: "Não foi possível enviar a foto. Tente de novo." }, 500);
  }
}

/** Ler a foto: quem vê a Agenda (atendimento.ver) ou a gestão. A URL tem a versão, então o cache pode ser longo. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/profissionais/[id]/foto">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "atendimento.ver") && !can(user.perms, "config.diaadia")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  const photo = await readProfessionalPhoto(id, req.nextUrl.searchParams.get("tam") === "grande" ? "full" : "q");
  if (!photo) return new Response("sem foto", { status: 404 });
  const headers = mediaHeaders(photo.mime?.startsWith("image/") ? photo.mime : null, photo.name);
  return new Response(new Uint8Array(photo.data), { headers: { ...headers, "cache-control": "private, max-age=31536000, immutable", "content-length": String(photo.data.length) } });
}
