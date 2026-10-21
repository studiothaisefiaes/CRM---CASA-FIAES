import path from "node:path";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { can } from "@/lib/permissions";
import { isUuid } from "@/lib/uuid";
import { findSessionUser } from "@/server/auth/sessions-store";
import { db } from "@/server/db";
import { clientNotes } from "@/server/db/schema";
import { canSeeNotePhoto } from "@/server/domain/client-notes";
import { mediaDir, readMediaFile } from "@/server/whatsapp/media";
import { photoHeaders, type PhotoMime } from "@/server/security/sniff";

/** Foto de uma anotação da ficha: a equipe que vê conversas ou contatos, ou a profissional com horário com a cliente (60 dias para trás e para a frente). */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/notas/[id]/foto">) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const [n] = await db.select({ contactId: clientNotes.contactId, file: clientNotes.mediaPath, mime: clientNotes.mediaMime, deletedAt: clientNotes.deletedAt }).from(clientNotes).where(eq(clientNotes.id, id));
  if (!n?.file || !n.mime || n.deletedAt) return new Response("não encontrado", { status: 404 });
  const team = can(user.perms, "atendimento.ver") || can(user.perms, "contatos.ver");
  if (!team && !(can(user.perms, "pro.app") && (await canSeeNotePhoto(user.id, n.contactId, new Date())))) return new Response("sem permissão", { status: 403 });
  const file = path.resolve(mediaDir(), n.file);
  if (!file.startsWith(path.resolve(mediaDir(), "notas") + path.sep)) return new Response("não encontrado", { status: 404 });
  const data = await readMediaFile(file).catch(() => null);
  if (!data) return new Response("não encontrado", { status: 404 });
  return new Response(new Uint8Array(data), { headers: { ...photoHeaders(n.mime as PhotoMime), "content-length": String(data.length) } });
}
