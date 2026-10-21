import { SYSTEM_PROFILES, type Perm } from "@/lib/permissions";

/** Permissões do perfil de sistema equivalente ao papel antigo: para testes que montam quem está vendo ({ id, perms }). */
export const permsFor = (role: "gestor" | "atendente" | "recepcao"): Perm[] =>
  [...SYSTEM_PROFILES.find((p) => p.key === (role === "gestor" ? "gestao" : role))!.permissions];
