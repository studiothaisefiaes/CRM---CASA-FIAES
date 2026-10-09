import { env } from "@/server/env";

/**
 * IP do cliente para o rate limit.
 * Com TRUSTED_PROXY_HOPS=n (n > 0) pega o n-ésimo IP da direita do x-forwarded-for: o que o proxy
 * confiável (Caddy) acrescentou. Com 0 ignora o cabeçalho (forjável) e usa o IP da conexão.
 * Server Action não enxerga o IP da conexão: com 0 a chave cai em "local" (todos dividem o limite).
 */
export function clientIp(h: Headers, socketIp?: string, hops: number = env().TRUSTED_PROXY_HOPS): string {
  const fallback = socketIp || "local";
  if (hops <= 0) return fallback;
  const list = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return fallback;
  return list[Math.max(0, list.length - hops)];
}
