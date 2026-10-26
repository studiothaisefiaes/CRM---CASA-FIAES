import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./server/security/csp";
import { CLIENT_HOST_FALLBACK, clientHostAllows, onClientHost } from "./lib/client-host";
import { API_MAX_BYTES, TEXTO_CORPO_GRANDE, TEXTO_SEM_TAMANHO } from "./server/api/corpo";

// Checagem otimista: só olha se o cookie existe. A verificação real fica na DAL (src/server/auth/session.ts).
// /imprimir: a página que o Chromium do servidor imprime em PDF não tem cookie; ela mesma exige o token de uso único.
// /api/v1: a API para scripts e integrações não tem cookie; cada rota exige a chave (Authorization: Bearer cf_…, src/server/api/rota.ts).
const PUBLIC = ["/login", "/convite", "/api/webhooks", "/api/importar", "/api/health", "/api/v1", "/manifest.webmanifest", "/imprimir", "/c", "/agendar"];

// Server Actions aceitam até 70 MB (next.config) por causa do vídeo bruto da resposta pronta e da Biblioteca (24/10). Nas outras telas,
// inclusive as abertas sem login (/login, /c, /agendar), vale o limite de antes (20 MB: anexo de 16 MB + folga): corpo maior é recusado
// aqui, pelo tamanho declarado, antes de a ação ler 70 MB para a memória.
const ACTION_MAX_BYTES = 20 * 1024 * 1024;
const BIG_UPLOAD_PAGES = new Set(["/config/listas", "/config/biblioteca"]);
const actionTooBig = (req: NextRequest) => req.method === "POST" && req.headers.has("next-action") && !BIG_UPLOAD_PAGES.has(req.nextUrl.pathname)
  && Number(req.headers.get("content-length") ?? 0) > ACTION_MAX_BYTES;

// API v1 (revisão de segurança 26/10): corpo acima de 17 MB (arquivo de 16 MB + folga) é recusado aqui, pelo tamanho declarado, antes de
// alguém ler para a memória; POST/PATCH sem Content-Length (corpo em pedaços, chunked) não tem tamanho para conferir: 411. A rota ainda
// confere o JSON (64 KB) contando os bytes (src/server/api/rota.ts).
const isApiV1 = (p: string) => p === "/api/v1" || p.startsWith("/api/v1/");
const apiErro = (status: number, erro: string) => NextResponse.json({ erro }, { status, headers: { "cache-control": "private, no-store" } });
function apiBodyRefusal(req: NextRequest): NextResponse | null {
  if (!isApiV1(req.nextUrl.pathname)) return null;
  const len = req.headers.get("content-length");
  if (len !== null && !(Number(len) <= API_MAX_BYTES)) return apiErro(413, TEXTO_CORPO_GRANDE);
  if ((req.method === "POST" || req.method === "PATCH") && (len === null || req.headers.has("transfer-encoding"))) return apiErro(411, TEXTO_SEM_TAMANHO);
  return null;
}

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (actionTooBig(req)) return new NextResponse("Arquivo grande demais.", { status: 413, headers: { "content-type": "text/plain; charset=utf-8" } });
  const apiRefused = apiBodyRefusal(req);
  if (apiRefused) return apiRefused;
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
