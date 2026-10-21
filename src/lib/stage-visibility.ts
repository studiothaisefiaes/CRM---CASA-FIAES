import { can } from "./permissions";

/**
 * A coluna da etapa aparece no Quadro de quem vê? Sem lista (null ou vazia) = todos. Quem configura o sistema (a gestão) vê todas.
 * Sem quem vê (Jornada, testes), todas. A Fila não usa isto: conversa esperando resposta nunca some.
 */
export function stageVisibleTo(s: { visibleProfileIds: string[] | null }, viewer?: { perms: readonly string[]; profileId?: string | null }): boolean {
  if (!viewer || !s.visibleProfileIds?.length || can(viewer.perms, "config.sistema")) return true;
  return !!viewer.profileId && s.visibleProfileIds.includes(viewer.profileId);
}
