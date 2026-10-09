import { NextResponse, type NextRequest } from "next/server";

// Checagem otimista: só olha se o cookie existe. A verificação real fica na DAL (src/server/auth/session.ts).
const PUBLIC = ["/login", "/convite", "/api/webhooks", "/api/health", "/manifest.webmanifest"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return NextResponse.next();
  if (!req.cookies.get("cf_session")?.value) {
    const url = new URL("/login", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("voltar", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|svg|ico|webp|mp3)$).*)"] };
