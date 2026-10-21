import { can } from "@/lib/permissions";

/** Quem faz a mudança: sempre a pessoa da sessão (a tela nunca diz quem é o autor). */
export type Actor = { id: string; perms: readonly string[] };
/** Encaixar por cima de outro horário ou fora do horário de trabalho (3.2). */
export const canFitIn = (a: Actor) => can(a.perms, "agenda.encaixar");
