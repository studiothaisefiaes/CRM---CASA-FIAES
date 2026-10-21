/**
 * Domínio dos links da cliente (CLIENT_LINK_URL, ex. https://agenda.casafiaes.com.br). Sem ele, os links usam o APP_URL.
 * Só lê variáveis (sem o env() completo): o proxy também usa.
 */
type Src = { APP_URL?: string; CLIENT_LINK_URL?: string; [k: string]: unknown };

/** Fora de /c, quem cai no host da cliente vai para o site da Casa. */
export const CLIENT_HOST_FALLBACK = "https://casafiaes.com.br";

const hostOf = (url: string | undefined) => { try { return url ? new URL(url).host.toLowerCase() : null; } catch { return null; } };

/** A base dos links da cliente, sem barra no fim. */
export function clientLinkBase(src: Src = process.env): string {
  return (String(src.CLIENT_LINK_URL || src.APP_URL || "")).replace(/\/+$/, "");
}

/** O host só da cliente (o de CLIENT_LINK_URL), ou null quando não há um separado do CRM. */
export function clientOnlyHost(src: Src = process.env): string | null {
  const h = hostOf(src.CLIENT_LINK_URL);
  return h && h !== hostOf(src.APP_URL) ? h : null;
}

/**
 * No host da cliente só valem a página do link (/c/...), o agendamento online (/agendar, 18/10: o link que a Casa divulga) e o que o
 * Next precisa para elas funcionarem.
 */
export function clientHostAllows(pathname: string, dev = false): boolean {
  if (pathname.startsWith("/c/") || pathname === "/agendar" || pathname.startsWith("/_next/")) return true;
  return dev && pathname.startsWith("/__nextjs");
}

/** O pedido chegou pelo host só da cliente? (As rotas que o proxy não vê, como os webhooks, recusam com 404.) */
export function onClientHost(h: Headers, src: Src = process.env): boolean {
  const host = clientOnlyHost(src);
  return !!host && (h.get("host") ?? "").toLowerCase() === host;
}
