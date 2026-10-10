/** Serviços de push dos navegadores. A inscrição vem do cliente, então só estes destinos são aceitos (evita o servidor chamar qualquer URL). */
const EXACT = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com"]);
const SUFFIX = [".push.apple.com", ".notify.windows.com", ".push.services.mozilla.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  return EXACT.has(h) || SUFFIX.some((s) => h.endsWith(s) && h.length > s.length);
}
