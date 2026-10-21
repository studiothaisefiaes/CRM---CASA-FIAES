import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./server/security/csp";
import { CLIENT_HOST_FALLBACK, clientHostAllows, onClientHost } from "./lib/client-host";

// Checagem otimista: só olha se o cookie existe. A verificação real fica na DAL (src/server/auth/session.ts).
// /imprimir: a página que o Chromium do servidor imprime em PDF não tem cookie; ela mesma exige o token de uso único.
const PUBLIC = ["/login", "/convite", "/api/webhooks", "/api/importar", "/api/health", "/manifest.webmanifest", "/imprimir", "/c", "/agendar"];

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // CSP com nonce novo a cada página (inclusive /login e /convite); o Next lê o nonce do cabeçalho da requisição.
  // Rotas de API não levam: não são HTML, e a de mídia manda a sua própria (sandbox).
  const next = () => {
    if (pathname.startsWith("/api/")) return NextResponse.next();
    const nonce = btoa(crypto.randomUUID());
    const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("content-security-policy", csp);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("content-security-policy", csp);
    return res;
  };
  // Host só da cliente (CLIENT_LINK_URL, ex. agenda.casafiaes.com.br): só a página do link, sem login. O resto vai para o site da Casa
  // (nada do CRM, nem /login, aparece nesse endereço).
  if (onClientHost(req.headers)) {
    if (clientHostAllows(pathname, process.env.NODE_ENV === "development")) return next();
    return NextResponse.redirect(CLIENT_HOST_FALLBACK, 307);
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"))) return next();
  if (!req.cookies.get("cf_session")?.value) {
    const url = new URL("/login", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("voltar", pathname);
    return NextResponse.redirect(url);
  }
  return next();
}

// O webhook não passa pelo proxy: não precisa de sessão e o proxy cortaria lotes de histórico acima de 10 MB.
export const config = { matcher: ["/((?!_next/static|_next/image|api/webhooks|api/importar|favicon.ico|sw\\.js$|.*\\.(?:png|jpg|svg|ico|webp|mp3|webmanifest)$).*)"] };
