/**
 * Ambiente de demonstração (DEMO=true): dados fictícios no banco crm_demo e WhatsApp de mentira.
 * A flag só vale com um banco de demonstração; o banco real nunca roda em modo demonstração.
 * 18/10 (QA r58, I-17): além do crm_demo, vale um crm_demo_<nome> (letras minúsculas, números e _), para cada pasta ter a sua cópia
 * (`DEMO_DB=crm_demo_x scripts/demo.sh seed`) sem apagar a demonstração de outra pessoa.
 */
export const DEMO_DATABASE = "crm_demo";
const DEMO_NAME = /^crm_demo(?:_[a-z0-9]+(?:_[a-z0-9]+)*)?$/;

/** O nome do banco de demonstração do endereço, ou null se o endereço não for de um banco de demonstração. */
export function demoDatabaseName(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const name = decodeURIComponent(new URL(url).pathname.slice(1));
    return DEMO_NAME.test(name) ? name : null;
  } catch { return null; }
}

export const isDemoDatabaseUrl = (url: string | null | undefined): boolean => demoDatabaseName(url) !== null;
