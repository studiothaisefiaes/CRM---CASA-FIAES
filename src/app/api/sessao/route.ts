import { cookies } from "next/headers";
import { findSessionUser } from "@/server/auth/sessions-store";
import { SESSION_COOKIE } from "@/server/auth/session";

/** A sessão ainda vale? 204 sim, 401 não. O tempo real pergunta quando o stream cai, para avisar "entre de novo" em vez de ficar mudo. */
export async function GET() {
  const user = await findSessionUser((await cookies()).get(SESSION_COOKIE)?.value);
  return new Response(null, { status: user ? 204 : 401, headers: { "cache-control": "no-store" } });
}
