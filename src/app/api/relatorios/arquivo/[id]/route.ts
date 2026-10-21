import type { NextRequest } from "next/server";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { reportsDir } from "@/server/reports/pdf";
import { eq } from "drizzle-orm";
import { findSessionUser } from "@/server/auth/sessions-store";
import { can } from "@/lib/permissions";
import { db } from "@/server/db";
import { reportFiles } from "@/server/db/schema";
import { isUuid } from "@/lib/uuid";

/** Fechamento mensal guardado: tem números da equipe e valores, então pede exportar + equipe + valores. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await findSessionUser(req.cookies.get("cf_session")?.value);
  if (!user) return new Response("não autorizado", { status: 401 });
  if (!can(user.perms, "relatorios.exportar") || !can(user.perms, "relatorios.equipe") || !can(user.perms, "valores.ver")) return new Response("sem permissão", { status: 403 });
  const { id } = await ctx.params;
  if (!isUuid(id)) return new Response("não encontrado", { status: 404 });
  const [f] = await db.select().from(reportFiles).where(eq(reportFiles.id, id));
  if (!f) return new Response("não encontrado", { status: 404 });
  const buf = await readFile(isAbsolute(f.path) ? f.path : join(reportsDir(), basename(f.path))).catch(() => null);
  if (!buf) return new Response("arquivo não encontrado no servidor", { status: 404 });
  return new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="casa-fiaes-fechamento-${f.periodKey}.pdf"`, "cache-control": "no-store" } });
}
