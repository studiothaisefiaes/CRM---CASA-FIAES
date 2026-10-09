/** Content-Security-Policy das páginas (montada no proxy, com nonce novo por requisição). */
export function contentSecurityPolicy(nonce: string, dev: boolean) {
  return [
    "default-src 'self'",
    // Em dev o React usa eval para reconstruir as pilhas de erro do servidor (guia de CSP do Next).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // motion anima por style inline; o Next injeta <style> sem nonce no modo dev.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    // SSE (/api/stream) é same-origin; em dev o HMR usa websocket.
    `connect-src 'self'${dev ? " ws:" : ""}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
