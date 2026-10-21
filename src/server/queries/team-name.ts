// src/server/queries/team-name.ts
import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "../db/schema";

/** Como a equipe se chama, para consultas que já juntam `users`: a assinatura ("CATI" → "Cati"); sem ela, o nome cadastrado. */
export const teamNameCol = () => sql<string | null>`coalesce(initcap(lower(${users.signature})), ${users.name})`;

/** O mesmo, buscando a pessoa pelo id (coluna ou trecho SQL): para quem não junta `users`. */
export const teamNameOf = (id: AnyPgColumn | SQL) =>
  sql<string | null>`(select coalesce(initcap(lower(tn.signature)), tn.name) from users tn where tn.id = ${id})`;
