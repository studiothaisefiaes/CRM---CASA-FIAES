import { sql } from "drizzle-orm";
import { users } from "../db/schema";

/**
 * Quem pode receber uma conversa ("Passar para…", atribuir em massa): perfil com "Ver Conversas" (atendimento.ver).
 * A profissional (perfil Profissional, só o app /pro) não abre a Fila: passar para ela deixava a conversa sem ninguém (varredura 17/10).
 * Sem perfil (legado dos testes e de antes dos perfis) continua valendo.
 */
export const canReceiveConversation = () =>
  sql`(${users.profileId} is null or exists (select 1 from profiles p where p.id = ${users.profileId} and 'atendimento.ver' = any(p.permissions)))`;
