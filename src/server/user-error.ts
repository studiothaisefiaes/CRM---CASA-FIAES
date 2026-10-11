import { z } from "zod";
import { UserFacingError } from "./domain/errors";
import { SendError } from "./domain/send";
import { ReopenConflict } from "./domain/deals";
import { ProviderError } from "./whatsapp/provider";

export const GENERIC_ERROR = "Não deu certo. Tente de novo.";

/**
 * O texto de erro que uma Server Action pode mostrar na tela.
 * Passam: a regra do zod, os erros do domínio com texto fixo em pt-BR (UserFacingError, SendError, ProviderError, ReopenConflict e o
 * `new Error("…")` simples que o domínio lança). Todo o resto (SQL do drizzle/pg, erro de sistema com `code`, TypeError…) vai para o log
 * e a tela recebe `fallback` (padrão: "Não deu certo. Tente de novo.").
 */
export function userErrorMessage(e: unknown, where: string, fallback = GENERIC_ERROR): string {
  if (e instanceof z.ZodError) return e.issues[0]?.message ?? fallback;
  if (e instanceof UserFacingError || e instanceof SendError || e instanceof ProviderError || e instanceof ReopenConflict) return e.message;
  // Erro "de domínio": Error simples, sem código de sistema/banco e sem causa embrulhada, e que não é texto de SQL.
  if (e instanceof Error && e.constructor === Error && !("code" in e) && e.cause === undefined && !/^Failed query/i.test(e.message) && e.message.trim()) return e.message;
  console.error(`[${where}]`, e);
  return fallback;
}
