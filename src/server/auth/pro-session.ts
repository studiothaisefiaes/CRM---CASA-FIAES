import "server-only";
import { requirePerm } from "./session";
import type { SessionUser } from "./sessions-store";
import { resolvePro, type ProContext } from "../queries/pro";
import { UserFacingError } from "../domain/errors";

/**
 * Telas do app: exige `pro.app` e devolve a profissional ligada. Sem ligação devolve `pro: null` e a tela não mostra nada:
 * o layout já mostra o aviso. Não redireciona: layout e página rodam em paralelo, e redirecionar daqui faria laço em /pro.
 */
export async function requirePro(): Promise<{ user: SessionUser; pro: ProContext | null }> {
  const user = await requirePerm("pro.app");
  return { user, pro: await resolvePro(user.id) };
}

/** Server actions do app: a profissional da sessão, ou o erro em PT-BR. */
export async function proOf(user: SessionUser): Promise<ProContext> {
  const pro = await resolvePro(user.id);
  if (!pro) throw new UserFacingError("Sua conta ainda não está ligada a uma profissional. Fale com a gestão.");
  return pro;
}
