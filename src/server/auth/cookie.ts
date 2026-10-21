/**
 * Cookie de sessão só por HTTPS em produção. A demonstração (DEMO=true) é um build de produção servido em http na rede local,
 * para abrir no celular: lá o navegador descartaria um cookie Secure e o login não ficaria.
 */
export function secureSessionCookie(opts: { nodeEnv: string | undefined; demo: boolean }): boolean {
  return opts.nodeEnv === "production" && !opts.demo;
}
