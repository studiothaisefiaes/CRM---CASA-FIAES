/**
 * Ambiente de demonstração (DEMO=true): dados fictícios no banco crm_demo e WhatsApp de mentira.
 * A flag só vale com o banco crm_demo; o banco real nunca roda em modo demonstração.
 */
export const DEMO_DATABASE = "crm_demo";

export function isDemoDatabaseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try { return new URL(url).pathname === `/${DEMO_DATABASE}`; } catch { return false; }
}
